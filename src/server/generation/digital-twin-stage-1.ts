import "server-only";

import {
  digitalTwinStage1ContentSchema,
  type DigitalTwinStage1Content,
  type DigitalTwinStage1Record,
} from "@/lib/digital-twin-stage-1";
import type { DigitalTwinSelection } from "@/lib/digital-twin";
import type { RunContext } from "@/server/generation/runs";
import {
  mapWithConcurrency,
  positiveIntEnv,
} from "@/server/generation/runtime";
import { configuredModel, generateJson } from "@/server/llm/openrouter";
import { readDigitalTwinProfile } from "@/server/storage/digital-twin-profiles";
import {
  listDigitalTwinStage1Records,
  writeDigitalTwinStage1Record,
} from "@/server/storage/digital-twin-stage-1";

const DEFAULT_TARGET_NARRATIVE_WORDS = 800;
const DEFAULT_MAX_CONCURRENT = 2;

const CLAIM_FIELDS = [
  "demographic_context",
  "values_and_beliefs",
  "personality_and_social_style",
  "decision_patterns",
  "risk_and_financial_preferences",
  "uncertainties_and_tensions",
] as const;

const SYSTEM_PROMPT = `You construct evidence-grounded personas for a behavioral-prediction benchmark.

Your only source is a participant's non-held-out Waves 1–3 survey record. Build a useful portrait of how this person thinks and makes decisions while preserving the evidence needed for later predictions.

Rules:
- Never invent a name, event, relationship, occupation, motive, preference, or demographic fact.
- Treat every interpretation as an inference, not an observed fact.
- Preserve meaningful contradictions instead of resolving them into a cleaner personality.
- Every structured claim must cite one or more exact QuestionID values from the supplied record.
- Use high confidence for direct answers, medium for patterns supported by several answers, and low for cautious interpretations.
- The narrative may synthesize patterns, but every factual assertion must be supported by the cited structured claims.
- Do not predict answers to questions that are not in the supplied evidence.
- Do not mention the benchmark, prompt, or that you are an AI.

Return only the requested JSON object.`;

export function digitalTwinStage1TargetWords(): number {
  return positiveIntEnv(
    process.env.DIGITAL_TWIN_STAGE_1_TARGET_WORDS,
    DEFAULT_TARGET_NARRATIVE_WORDS,
  );
}

export function digitalTwinStage1MaxConcurrent(): number {
  return positiveIntEnv(
    process.env.DIGITAL_TWIN_STAGE_1_MAX_CONCURRENT,
    DEFAULT_MAX_CONCURRENT,
  );
}

function collectQuestionIds(value: unknown, output = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectQuestionIds(item, output);
    return output;
  }
  if (typeof value !== "object" || value === null) return output;

  const record = value as Record<string, unknown>;
  if (typeof record.QuestionID === "string") output.add(record.QuestionID);
  for (const child of Object.values(record)) collectQuestionIds(child, output);
  return output;
}

function groundedContentSchema(questionIds: Set<string>) {
  return digitalTwinStage1ContentSchema.superRefine((content, context) => {
    for (const field of CLAIM_FIELDS) {
      content[field].forEach((claim, claimIndex) => {
        claim.source_question_ids.forEach((questionId, questionIndex) => {
          if (!questionIds.has(questionId)) {
            context.addIssue({
              code: "custom",
              message: `Unknown source QuestionID: ${questionId}`,
              path: [field, claimIndex, "source_question_ids", questionIndex],
            });
          }
        });
      });
    }
  });
}

function prompt(personaJson: string, targetWords: number): string {
  return `Create a persona from the survey evidence below.

Write the narrative at roughly ${targetWords} words. Make it detailed enough to support later behavioral predictions, but do not add unsupported biography. Use inline QuestionID citations where helpful, such as [QID42].

Return exactly this shape:
{
  "narrative": "Evidence-grounded prose portrait",
  "demographic_context": [{"claim":"...","confidence":"high|medium|low","source_question_ids":["QID..."]}],
  "values_and_beliefs": [{"claim":"...","confidence":"high|medium|low","source_question_ids":["QID..."]}],
  "personality_and_social_style": [{"claim":"...","confidence":"high|medium|low","source_question_ids":["QID..."]}],
  "decision_patterns": [{"claim":"...","confidence":"high|medium|low","source_question_ids":["QID..."]}],
  "risk_and_financial_preferences": [{"claim":"...","confidence":"high|medium|low","source_question_ids":["QID..."]}],
  "uncertainties_and_tensions": [{"claim":"...","confidence":"high|medium|low","source_question_ids":["QID..."]}]
}

NON-HELD-OUT WAVES 1–3 SURVEY EVIDENCE:
${personaJson}`;
}

type GenerationResult =
  | { ok: true; profileId: string }
  | { ok: false; profileId: string; error: string; aborted?: boolean };

async function generateOne({
  selection,
  profileId,
  model,
  targetWords,
  run,
}: {
  selection: DigitalTwinSelection;
  profileId: string;
  model: string;
  targetWords: number;
  run?: RunContext;
}): Promise<GenerationResult> {
  if (run?.signal.aborted) {
    return {
      ok: false,
      profileId,
      error: "Cancelled before this persona started.",
      aborted: true,
    };
  }

  try {
    const source = await readDigitalTwinProfile(selection.id, profileId);
    if (!source) throw new Error("The selected Stage 0 persona file is missing.");

    const parsedEvidence = JSON.parse(source.wave1_3_persona_json) as unknown;
    const questionIds = collectQuestionIds(parsedEvidence);
    if (questionIds.size === 0) {
      throw new Error("The Stage 0 persona contains no source QuestionIDs.");
    }

    const content = (await generateJson({
      schema: groundedContentSchema(questionIds),
      system: SYSTEM_PROMPT,
      prompt: prompt(source.wave1_3_persona_json, targetWords),
      signal: run?.signal,
      temperature: 0,
    })) as DigitalTwinStage1Content;

    const record: DigitalTwinStage1Record = {
      ...content,
      profile_id: source.id,
      participant_id: source.participant_id,
      selection_id: selection.id,
      selection_seed: selection.seed,
      generated_at: new Date().toISOString(),
      model,
      source_persona_text_characters: source.persona_text_characters,
      source_persona_json_characters: source.persona_json_characters,
    };

    await writeDigitalTwinStage1Record(record);
    run?.itemDone();
    return { ok: true, profileId };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run?.itemFailed({ id: profileId, error: message });
    return {
      ok: false,
      profileId,
      error: message,
      aborted: run?.signal.aborted === true,
    };
  }
}

export async function generateDigitalTwinStage1({
  selection,
  skipExisting,
  run,
}: {
  selection: DigitalTwinSelection;
  skipExisting: boolean;
  run?: RunContext;
}) {
  const model = configuredModel();
  const existing = new Set(
    skipExisting
      ? (await listDigitalTwinStage1Records(selection.id)).map(
          (record) => record.profile_id,
        )
      : [],
  );
  const targets = selection.profiles.filter(
    (profile) => !existing.has(profile.id),
  );
  run?.setTotal(targets.length);

  const results = await mapWithConcurrency(
    targets,
    digitalTwinStage1MaxConcurrent(),
    (profile) =>
      generateOne({
        selection,
        profileId: profile.id,
        model,
        targetWords: digitalTwinStage1TargetWords(),
        run,
      }),
  );

  const succeeded = results.filter((result) => result.ok).length;
  const failed = results.filter(
    (result) => !result.ok && !result.aborted,
  ).length;

  return {
    profileCount: selection.profiles.length,
    generated: succeeded,
    failed,
    skipped: selection.profiles.length - targets.length,
  };
}
