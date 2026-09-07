import "server-only";

import { z } from "zod";

import type { DigitalTwinAnswer, DigitalTwinExecution } from "@/lib/digital-twin-stage-3";
import type { DigitalTwinStage1Record } from "@/lib/digital-twin-stage-1";
import {
  DIGITAL_TWIN_INPUT_ADAPTER_VERSION,
  type DigitalTwinEpisode,
} from "@/lib/digital-twin-stage-2";
import type { Description } from "@/lib/stage-1";
import type { Scenario } from "@/lib/stage-2";
import { FLOWS, flowByKey } from "@/server/flows";
import { flowStepsFor, stepSchema, type Flow, type FlowStep } from "@/server/flows/types";
import type { RunContext } from "@/server/generation/runs";
import { MAX_CONCURRENT_REQUESTS, mapWithConcurrency } from "@/server/generation/runtime";
import { configuredModel, generateJson } from "@/server/llm/openrouter";
import { listDigitalTwinStage1Records } from "@/server/storage/digital-twin-stage-1";
import { listDigitalTwinEpisodeRefs, readDigitalTwinEpisode } from "@/server/storage/digital-twin-stage-2";
import { listAllDigitalTwinExecutions, writeDigitalTwinExecution } from "@/server/storage/digital-twin-stage-3";

type AnswerSpec = { key: string; schema: z.ZodType<DigitalTwinAnswer>; instruction: string };

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function answerSpecs(episode: DigitalTwinEpisode): AnswerSpec[] {
  return episode.questions.flatMap((question) => {
    if (question.csv_columns.length === 0) return [];
    const options = strings(question.Options);
    const columns = strings(question.Columns);
    const rows = strings(question.Rows);
    const range = question.Range as { Min?: unknown; Max?: unknown } | undefined;

    return question.csv_columns.map((key, index) => {
      if (question.QuestionType === "MC") {
        if (options.length === 0) throw new Error(`${question.QuestionID} has no choice options.`);
        return { key, schema: z.number().int().min(1).max(options.length), instruction: `${key}: integer code ${options.map((option, i) => `${i + 1} = ${JSON.stringify(option)}`).join("; ")}` };
      }
      if (question.QuestionType === "Matrix") {
        if (columns.length === 0) throw new Error(`${question.QuestionID} has no matrix columns.`);
        const row = rows[index] ?? `row ${index + 1}`;
        return { key, schema: z.number().int().min(1).max(columns.length), instruction: `${key} (${row}): integer code ${columns.map((option, i) => `${i + 1} = ${JSON.stringify(option)}`).join("; ")}` };
      }
      if (question.QuestionType === "Slider") {
        const min = typeof range?.Min === "number" ? range.Min : undefined;
        const max = typeof range?.Max === "number" ? range.Max : undefined;
        let schema = z.number().finite();
        if (min !== undefined) schema = schema.min(min);
        if (max !== undefined) schema = schema.max(max);
        return { key, schema, instruction: `${key}: number${min !== undefined && max !== undefined ? ` from ${min} to ${max}` : ""}` };
      }
      if (question.QuestionType === "TE") {
        return { key, schema: z.number().finite(), instruction: `${key}: number` };
      }
      throw new Error(`Unsupported scored question type ${question.QuestionType} for ${question.QuestionID}.`);
    });
  });
}

function checkedAnswerSpecs(episode: DigitalTwinEpisode): AnswerSpec[] {
  const specs = answerSpecs(episode);
  const actual = [...new Set(specs.map((spec) => spec.key))].sort();
  const expected = [...new Set(episode.target_columns)].sort();
  if (actual.length !== specs.length || actual.join("\n") !== expected.join("\n")) {
    throw new Error(`Question-to-column mapping does not match target_columns for ${episode.id}.`);
  }
  return specs;
}

function answersSchema(specs: AnswerSpec[]) {
  return z.object({
    answers: z.object(Object.fromEntries(specs.map((spec) => [spec.key, spec.schema]))).strict(),
  });
}

function asFlowInputs(persona: DigitalTwinStage1Record, episode: DigitalTwinEpisode) {
  const description: Description = {
    profile_id: persona.profile_id,
    name: `Participant ${persona.participant_id}`,
    headline: episode.task_label,
    description: persona.narrative,
    profile_generated_at: null,
    generated_at: persona.generated_at,
    model: persona.model,
  };
  const scenario: Scenario = {
    id: episode.id,
    profile_id: episode.profile_id,
    name: description.name,
    headline: description.headline,
    title: episode.task_label,
    situation_type: "NORMAL",
    life_domain: null,
    situation: episode.situation,
    context: episode.context,
    context_generated_at: episode.generated_at,
    description_generated_at: persona.generated_at,
    generated_at: episode.generated_at,
    model: episode.model,
  };
  return { description, scenario };
}

function current(execution: DigitalTwinExecution | null, persona: DigitalTwinStage1Record, episode: DigitalTwinEpisode) {
  return execution !== null && execution.stage1_generated_at === persona.generated_at && execution.episode_generated_at === episode.generated_at;
}

function intermediateSteps(flow: Flow, scenario: Scenario): FlowStep[] {
  return flowStepsFor(flow, scenario).filter((step) => step.key !== flow.outcome?.stepKey);
}

function predictionPrompt({ original, scenario, description, prior, episode, specs }: {
  original: FlowStep;
  scenario: Scenario;
  description: Description;
  prior: Record<string, Record<string, string>>;
  episode: DigitalTwinEpisode;
  specs: AnswerSpec[];
}) {
  return `${original.buildPrompt({ scenario, description, prior })}\n\nBENCHMARK OUTPUT ADAPTER\nThe observable outcome here is the participant's answers to the survey questions, not a free-form action. Apply the reasoning above to predict how this specific person would answer. Do not answer as an average person and do not use any hidden reference or retest answers.\n\nReturn exactly one JSON object with an \"answers\" object. It must contain every key below exactly once and no other keys. Choice codes are 1-based positions in the displayed order.\n\n${specs.map((spec) => `- ${spec.instruction}`).join("\n")}\n\nTask: ${episode.task_label}`;
}

export type DigitalTwinStage3Plan = {
  entries: { episode: DigitalTwinEpisode; persona: DigitalTwinStage1Record; flow: Flow; steps: FlowStep[]; needsAnswers: boolean; existing: DigitalTwinExecution | null }[];
  episodeCount: number;
  skippedCells: number;
};

export async function planDigitalTwinStage3({ selectionId, flowKeys, skipExisting }: { selectionId: string; flowKeys: string[]; skipExisting: boolean }): Promise<DigitalTwinStage3Plan> {
  const unknown = flowKeys.filter((key) => !flowByKey(key));
  if (unknown.length) throw new Error(`Unknown flows: ${unknown.join(", ")}`);
  const [personas, refs, executions] = await Promise.all([
    listDigitalTwinStage1Records(selectionId),
    listDigitalTwinEpisodeRefs(selectionId),
    listAllDigitalTwinExecutions(selectionId),
  ]);
  const personaById = new Map(personas.map((persona) => [persona.profile_id, persona]));
  const loaded = (await Promise.all(refs.map((ref) => readDigitalTwinEpisode(selectionId, ref.profileId, ref.episodeId)))).filter((episode): episode is DigitalTwinEpisode => episode !== null);
  const episodes = loaded.filter(
    (episode) =>
      personaById.get(episode.profile_id)?.generated_at ===
        episode.stage1_generated_at &&
      episode.input_adapter_version === DIGITAL_TWIN_INPUT_ADAPTER_VERSION,
  );
  const stored = new Map(executions.map((execution) => [`${execution.profile_id}/${execution.episode_id}/${execution.flow_key}`, execution]));
  const flows = FLOWS.filter((flow) => flowKeys.includes(flow.key));
  const entries: DigitalTwinStage3Plan["entries"] = [];
  let skippedCells = 0;

  for (const episode of episodes) {
    const persona = personaById.get(episode.profile_id)!;
    const { scenario } = asFlowInputs(persona, episode);
    for (const flow of flows) {
      const found = stored.get(`${episode.profile_id}/${episode.id}/${flow.key}`) ?? null;
      const existing = skipExisting && current(found, persona, episode) ? found : null;
      const allSteps = intermediateSteps(flow, scenario);
      let rerun = !skipExisting || existing === null;
      const steps = allSteps.filter((step) => {
        const complete = !rerun && step.fields.every((field) => field.key in (existing?.steps[step.key]?.output ?? {}));
        if (!complete) rerun = true;
        return !complete;
      });
      const specs = checkedAnswerSpecs(episode);
      const needsAnswers =
        rerun ||
        existing?.answers === null ||
        !answersSchema(specs).safeParse({ answers: existing?.answers }).success;
      if (steps.length === 0 && !needsAnswers) skippedCells++;
      else entries.push({ episode, persona, flow, steps, needsAnswers, existing });
    }
  }
  return { entries, episodeCount: episodes.length, skippedCells };
}

export function callsInDigitalTwinPlanEntry(entry: DigitalTwinStage3Plan["entries"][number]) {
  return entry.steps.length + (entry.needsAnswers ? 1 : 0);
}

async function runEntry(entry: DigitalTwinStage3Plan["entries"][number], model: string, run?: RunContext) {
  const { episode, persona, flow } = entry;
  const { scenario, description } = asFlowInputs(persona, episode);
  const now = new Date().toISOString();
  let record: DigitalTwinExecution = entry.existing ?? {
    selection_id: episode.selection_id, profile_id: episode.profile_id, participant_id: episode.participant_id,
    episode_id: episode.id, task_key: episode.task_key, task_label: episode.task_label, flow_key: flow.key,
    steps: {}, answers: null, answers_generated_at: null, stage1_generated_at: persona.generated_at,
    episode_generated_at: episode.generated_at, started_at: now, updated_at: now,
  };
  try {
    for (const step of entry.steps) {
      if (run?.signal.aborted) return { ok: false, aborted: true, error: "cancelled" };
      const output = await generateJson({ schema: stepSchema(step), system: step.system, prompt: step.buildPrompt({ scenario, description, prior: Object.fromEntries(Object.entries(record.steps).map(([key, value]) => [key, value.output])) }), signal: run?.signal, temperature: 0 });
      const at = new Date().toISOString();
      record = { ...record, steps: { ...record.steps, [step.key]: { output, generated_at: at, model } }, answers: null, answers_generated_at: null, updated_at: at };
      await writeDigitalTwinExecution(record); run?.itemDone();
    }
    if (entry.needsAnswers && !run?.signal.aborted) {
      const decision = flowStepsFor(flow, scenario).find((step) => step.key === flow.outcome?.stepKey);
      if (!decision) throw new Error(`Flow ${flow.key} has no decision step.`);
      const specs = checkedAnswerSpecs(episode);
      const result = await generateJson({ schema: answersSchema(specs), system: `${decision.system}\n\nFor this benchmark, the final response must be the requested coded survey answers.`, prompt: predictionPrompt({ original: decision, scenario, description, prior: Object.fromEntries(Object.entries(record.steps).map(([key, value]) => [key, value.output])), episode, specs }), signal: run?.signal, temperature: 0 });
      const at = new Date().toISOString();
      record = { ...record, answers: result.answers, answers_generated_at: at, updated_at: at };
      await writeDigitalTwinExecution(record); run?.itemDone();
    }
    return { ok: true, aborted: false, error: null };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run?.itemFailed({ id: `${episode.profile_id} · ${episode.task_key} · ${flow.key}`, error: message });
    return { ok: false, aborted: run?.signal.aborted === true, error: message };
  }
}

export async function generateDigitalTwinStage3({ selectionId, flowKeys, skipExisting, limit, run }: { selectionId: string; flowKeys: string[]; skipExisting: boolean; limit?: number; run?: RunContext }) {
  const plan = await planDigitalTwinStage3({ selectionId, flowKeys, skipExisting });
  const episodeIds = [...new Set(plan.entries.map((entry) => `${entry.episode.profile_id}/${entry.episode.id}`))];
  const allowed = new Set(limit === undefined ? episodeIds : episodeIds.slice(0, limit));
  const entries = plan.entries.filter((entry) => allowed.has(`${entry.episode.profile_id}/${entry.episode.id}`));
  run?.setTotal(entries.reduce((sum, entry) => sum + callsInDigitalTwinPlanEntry(entry), 0));
  const model = configuredModel();
  const results = await mapWithConcurrency(entries, MAX_CONCURRENT_REQUESTS, (entry) => runEntry(entry, model, run));
  return { skipped: plan.skippedCells, limitedOut: episodeIds.length - allowed.size, failed: results.filter((result) => !result.ok && !result.aborted).length };
}
