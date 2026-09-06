import "server-only";

import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Description } from "@/lib/stage-1";
import type { DigitalTwinStage1Record } from "@/lib/digital-twin-stage-1";
import {
  digitalTwinTargetQuestionSchema,
  type DigitalTwinEpisode,
  type DigitalTwinTargetQuestion,
} from "@/lib/digital-twin-stage-2";
import type { DigitalTwinSelection } from "@/lib/digital-twin";
import type { RunContext } from "@/server/generation/runs";
import { generateScenarioContext } from "@/server/generation/scenarios";
import {
  MAX_CONCURRENT_REQUESTS,
  mapWithConcurrency,
} from "@/server/generation/runtime";
import { configuredModel } from "@/server/llm/openrouter";
import { listDigitalTwinStage1Records } from "@/server/storage/digital-twin-stage-1";
import {
  listDigitalTwinEpisodeRefs,
  readDigitalTwinEpisode,
  writeDigitalTwinEpisode,
} from "@/server/storage/digital-twin-stage-2";
import { readStage2Config } from "@/server/storage/scenarios";

const QUESTION_CATALOG = path.join(
  process.cwd(),
  "datasets",
  "digital-twin",
  "question_catalog",
  "question_catalog.json",
);

type TaskDefinition = {
  key: string;
  label: string;
  questionIds: readonly string[];
};

const range = (start: number, end: number) =>
  Array.from({ length: end - start + 1 }, (_, index) => `QID${start + index}`);

/** Mirrors the 17 task families used by the official MAD evaluator. */
export const DIGITAL_TWIN_TASKS: readonly TaskDefinition[] = [
  { key: "false_consensus", label: "False consensus", questionIds: ["QID287", "QID290"] },
  { key: "base_rate", label: "Base rate", questionIds: ["QID154", "QID156"] },
  { key: "framing_problem", label: "Framing problem", questionIds: ["QID157", "QID158"] },
  { key: "linda_conjunction", label: "Conjunction problem (Linda)", questionIds: ["QID159", "QID160"] },
  { key: "outcome_bias", label: "Outcome bias", questionIds: ["QID161", "QID162"] },
  { key: "anchoring", label: "Anchoring and adjustment", questionIds: range(163, 170) },
  { key: "less_is_more", label: "Less is more", questionIds: range(171, 179) },
  { key: "sunk_cost", label: "Sunk cost fallacy", questionIds: ["QID181", "QID182"] },
  { key: "absolute_relative", label: "Absolute vs. relative savings", questionIds: ["QID183", "QID184"] },
  { key: "wta_wtp", label: "WTA/WTP-Thaler", questionIds: ["QID189", "QID190", "QID191"] },
  { key: "allais", label: "Allais", questionIds: ["QID192", "QID193"] },
  { key: "myside", label: "Myside", questionIds: ["QID194", "QID195"] },
  { key: "probability_matching", label: "Probability matching vs. maximizing", questionIds: ["QID198", "QID203"] },
  { key: "non_separability", label: "Non-separability of risks and benefits", questionIds: ["QID288", "QID289"] },
  { key: "omission", label: "Omission", questionIds: ["QID291"] },
  { key: "denominator_neglect", label: "Denominator neglect", questionIds: ["QID196"] },
  {
    key: "pricing",
    label: "Product preferences and pricing",
    questionIds: ["QID8", ...Array.from({ length: 40 }, (_, index) => `QID9_${index + 1}`)],
  },
] as const;

export function digitalTwinStage2MaxConcurrent(): number {
  return MAX_CONCURRENT_REQUESTS;
}

async function targetTasks(): Promise<
  { definition: TaskDefinition; questions: DigitalTwinTargetQuestion[] }[]
> {
  const raw = JSON.parse(await readFile(QUESTION_CATALOG, "utf8")) as unknown;
  if (!Array.isArray(raw)) {
    throw new Error("Digital Twin question catalog is not an array.");
  }

  const heldOut = raw
    .filter(
      (question): question is Record<string, unknown> =>
        typeof question === "object" &&
        question !== null &&
        question.source === "wave4_Q_wave1_3_A",
    )
    .map((question) => digitalTwinTargetQuestionSchema.parse(question));
  const byId = new Map(heldOut.map((question) => [question.QuestionID, question]));
  const assigned = new Set<string>();

  const tasks = DIGITAL_TWIN_TASKS.map((definition) => {
    const questions = definition.questionIds.map((questionId) => {
      const question = byId.get(questionId);
      if (!question) {
        throw new Error(`Held-out question ${questionId} is missing from the catalog.`);
      }
      if (assigned.has(questionId)) {
        throw new Error(`Held-out question ${questionId} is assigned twice.`);
      }
      assigned.add(questionId);
      return question;
    });
    return { definition, questions };
  });

  const unassigned = heldOut.filter(
    (question) => !assigned.has(question.QuestionID),
  );
  if (unassigned.length > 0 || assigned.size !== heldOut.length) {
    throw new Error(
      `Digital Twin task map covers ${assigned.size} of ${heldOut.length} held-out questions. ` +
        `Unassigned: ${unassigned.map((question) => question.QuestionID).join(", ") || "none"}.`,
    );
  }
  return tasks;
}

export async function digitalTwinTargetStats() {
  const tasks = await targetTasks();
  const questions = tasks.flatMap((task) => task.questions);
  return {
    taskCount: tasks.length,
    questionCount: questions.length,
    targetColumnCount: new Set(
      questions.flatMap((question) => question.csv_columns),
    ).size,
  };
}

function renderQuestion(question: DigitalTwinTargetQuestion): string {
  const details = Object.fromEntries(
    Object.entries(question).filter(
      ([key]) => !["source", "csv_columns", "BlockName"].includes(key),
    ),
  );
  return JSON.stringify(details, null, 2);
}

function renderSituation(
  label: string,
  questions: DigitalTwinTargetQuestion[],
): string {
  return `The participant is completing the "${label}" survey task. They are shown the following questions and response choices:\n\n${questions
    .map(renderQuestion)
    .join("\n\n")}`;
}

function descriptionFromPersona(persona: DigitalTwinStage1Record): Description {
  return {
    profile_id: persona.profile_id,
    name: `Participant ${persona.participant_id}`,
    headline: "Twin-2K-500 survey participant",
    description: persona.narrative,
    profile_generated_at: null,
    generated_at: persona.generated_at,
    model: persona.model,
  };
}

type EpisodeTarget = {
  persona: DigitalTwinStage1Record;
  definition: TaskDefinition;
  questions: DigitalTwinTargetQuestion[];
};

async function generateOne(
  selection: DigitalTwinSelection,
  target: EpisodeTarget,
  model: string,
  run?: RunContext,
) {
  const { persona, definition, questions } = target;
  const id = `task_${definition.key}`;
  if (run?.signal.aborted) {
    return { ok: false as const, id, aborted: true, error: "Cancelled." };
  }

  try {
    const config = await readStage2Config();
    const situation = renderSituation(definition.label, questions);
    const context = await generateScenarioContext({
      description: descriptionFromPersona(persona),
      config,
      title: definition.label,
      situation,
      situationType: "NORMAL",
      signal: run?.signal,
    });

    const episode: DigitalTwinEpisode = {
      id,
      profile_id: persona.profile_id,
      participant_id: persona.participant_id,
      selection_id: selection.id,
      task_key: definition.key,
      task_label: definition.label,
      situation_type: "NORMAL",
      situation,
      questions,
      target_columns: [
        ...new Set(questions.flatMap((question) => question.csv_columns)),
      ],
      context,
      stage1_generated_at: persona.generated_at,
      generated_at: new Date().toISOString(),
      model,
    };
    await writeDigitalTwinEpisode(episode);
    run?.itemDone();
    return { ok: true as const, id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const errorId = `${persona.profile_id}/${id}`;
    run?.itemFailed({ id: errorId, error: message });
    return {
      ok: false as const,
      id,
      error: message,
      aborted: run?.signal.aborted === true,
    };
  }
}

export async function generateDigitalTwinStage2({
  selection,
  skipExisting,
  run,
}: {
  selection: DigitalTwinSelection;
  skipExisting: boolean;
  run?: RunContext;
}) {
  const [personas, tasks, refs] = await Promise.all([
    listDigitalTwinStage1Records(selection.id),
    targetTasks(),
    listDigitalTwinEpisodeRefs(selection.id),
  ]);
  const existing = new Map(
    skipExisting
      ? (
          await Promise.all(
            refs.map((ref) =>
              readDigitalTwinEpisode(selection.id, ref.profileId, ref.episodeId),
            ),
          )
        )
          .filter((episode): episode is DigitalTwinEpisode => episode !== null)
          .map((episode) => [
            `${episode.profile_id}/${episode.id}`,
            episode.stage1_generated_at,
          ])
      : [],
  );

  const targets = personas.flatMap((persona) =>
    tasks
      .filter(
        ({ definition }) =>
          existing.get(`${persona.profile_id}/task_${definition.key}`) !==
          persona.generated_at,
      )
      .map(({ definition, questions }) => ({ persona, definition, questions })),
  );
  run?.setTotal(targets.length);
  const model = configuredModel();
  const results = await mapWithConcurrency(
    targets,
    digitalTwinStage2MaxConcurrent(),
    (target) => generateOne(selection, target, model, run),
  );

  return {
    personaCount: personas.length,
    taskCount: tasks.length,
    generated: results.filter((result) => result.ok).length,
    failed: results.filter((result) => !result.ok && !result.aborted).length,
    skipped: personas.length * tasks.length - targets.length,
  };
}

