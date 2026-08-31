import { z } from "zod";

import { situationTypeSchema, type SituationType } from "@/lib/stage-2";

/**
 * Stage 4 — evaluation, in two parts.
 *
 * Part 1 consolidates the Stage 1 and Stage 2 ground truth into a neutral
 * evaluation context. Part 2 judges each flow's predicted action against it.
 *
 * The split exists because the context must be built without seeing any flow's
 * output. If the same call both summarised the evidence and judged a prediction,
 * the summary could quietly be shaped to fit whatever it was about to score —
 * and it would have to be rebuilt per flow, so the arms would be judged against
 * subtly different pictures of the same person.
 *
 * That independence is why an evaluation context is keyed by *scenario* alone,
 * at `data/evaluation-contexts/<profile_id>/<scenario_id>.json`, and reused
 * across every flow. One consolidation per scenario, not per scenario × flow.
 */

/**
 * Whether reflection was available to the character, which decides whether
 * reflective memories are in scope for the evaluation context.
 *
 * A property of the *situation*, not of the flow being evaluated — see
 * `decisionModeFor`. Both flows are scored against the same context, so a mode
 * that varied per flow would make the arms incomparable.
 */
export const DECISION_MODES = ["IMMEDIATE", "REFLECTIVE"] as const;

export const decisionModeSchema = z.enum(DECISION_MODES);

export type DecisionMode = z.infer<typeof decisionModeSchema>;

/**
 * A TIME_SENSITIVE situation is one the character must answer now, so nothing
 * reachable only by deliberate reflection is available to judge them against.
 * Every other situation type leaves room to reflect.
 */
export function decisionModeFor(situationType: SituationType): DecisionMode {
  return situationType === "TIME_SENSITIVE" ? "IMMEDIATE" : "REFLECTIVE";
}

/** The model-generated body of part 1. */
export const evaluationContextContentSchema = z.object({
  character_and_relationship_context: z.string(),
  objective_situation: z.string(),
  state_and_available_memories: z.string(),
});

export type EvaluationContextContent = z.infer<
  typeof evaluationContextContentSchema
>;

/** The persisted evaluation context: part 1's output plus provenance. */
export const evaluationContextSchema = evaluationContextContentSchema.extend({
  profile_id: z.string(),
  scenario_id: z.string(),
  /** Copied from the scenario so listings render without reading Stage 2 too. */
  name: z.string(),
  scenario_title: z.string(),
  /**
   * The situation type this was built for, and the mode it therefore ran in.
   * Both recorded: the mode is what governed which memories were in scope, and
   * the type is the reason it took that value. A context whose mode no longer
   * matches its scenario's type was built under a rule that has since changed.
   */
  situation_type: z.string(),
  decision_mode: decisionModeSchema,
  /**
   * Whether reflective memories were actually supplied. Redundant with the mode
   * today, and kept anyway: it is the fact an auditor wants, and it stays true
   * if the rule mapping situations to modes is ever rewritten.
   */
  reflective_memories_included: z.boolean(),
  /**
   * When the scenario was created and when its context call finished. Both,
   * because Stage 2 writes a scenario twice and only the second write moves
   * `context_generated_at` — an evaluation context built from the half-written
   * scenario is stale the moment the episode context arrives.
   */
  scenario_generated_at: z.string(),
  scenario_context_generated_at: z.string(),
  /** When the Stage 1 description used as the character description was made. */
  description_generated_at: z.string(),
  generated_at: z.string(),
  model: z.string(),
});

export type EvaluationContext = z.infer<typeof evaluationContextSchema>;

/** The blocks part 1 emits, in the order the page shows them. */
export const EVALUATION_CONTEXT_FIELDS = [
  {
    key: "character_and_relationship_context",
    label: "Character and relationship context",
  },
  { key: "objective_situation", label: "Objective situation" },
  {
    key: "state_and_available_memories",
    label: "State and available memories",
  },
] as const;

/**
 * Which situation types a Stage 4 view is showing. `ALL` is the unfiltered
 * view; anything else narrows to one Stage 2 situation type.
 *
 * The comparison this exists for is whether reflection earns its keep where
 * there is time to reflect. TIME_SENSITIVE is exactly where it should not —
 * that type forces IMMEDIATE mode, so the evaluator judges both flows without
 * reflective memories — and an average taken across all three types hides that.
 *
 * Derived from Stage 2's enum rather than restated, so a new situation type
 * becomes filterable instead of silently falling only into `ALL`.
 */
export const SITUATION_FILTERS = [
  "ALL",
  ...situationTypeSchema.options,
] as const;

export type SituationFilter = (typeof SITUATION_FILTERS)[number];

/** Short labels for the filter chips. The stored values stay canonical. */
export const SITUATION_FILTER_LABELS: Record<SituationFilter, string> = {
  ALL: "All",
  NORMAL: "Normal",
  CULTURE_RELEVANT: "Culture",
  TIME_SENSITIVE: "Time-sensitive",
};

/**
 * Reads `?type=` from the URL, falling back to `ALL` for anything unrecognised —
 * a hand-edited URL cannot put the page into a filter the chips can't undo.
 */
export function situationFilterFromParam(
  raw: string | string[] | undefined,
): SituationFilter {
  const value = Array.isArray(raw) ? raw[0] : raw;
  return (SITUATION_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as SituationFilter)
    : "ALL";
}

/**
 * The top of the scoring scale.
 *
 * Stamped onto every evaluation as `score_scale`, because a score is only
 * comparable to another score taken on the same scale: a 4 out of 5 and a 4 out
 * of 10 are different judgements wearing the same digit. Raising this
 * invalidates every evaluation taken under the old one rather than quietly
 * averaging the two together.
 */
export const SCORE_SCALE_MAX = 10;

/** One dimension of part 2's judgement. */
export const scoreSchema = z.number().int().min(1).max(SCORE_SCALE_MAX);

/** The dimensions part 2 scores, in the order the page shows them. */
export const SCORE_DIMENSIONS = [
  {
    key: "character_consistency",
    label: "Character consistency",
    question:
      "Does the action fit the character description, relationship profiles, and established tendencies?",
  },
  {
    key: "situation_fit",
    label: "Situation fit",
    question:
      "Does the action directly and feasibly respond to the objective situation, including its timing and practical constraints?",
  },
  {
    key: "state_memory_alignment",
    label: "State/memory alignment",
    question:
      "Does the action fit the character's current state and the memories available in the evaluation context?",
  },
] as const;

/** What each point on the scale means. */
export const SCORE_SCALE: Record<number, string> = {
  1: "Directly contradicts the established evidence.",
  2: "Strongly inconsistent with the character or situation.",
  3: "Weakly supported with major problems.",
  4: "More inconsistent than consistent.",
  5: "Borderline plausible but poorly grounded.",
  6: "Generally plausible with noticeable weaknesses.",
  7: "Clearly plausible and adequately grounded.",
  8: "Strongly plausible and well grounded.",
  9: "Highly character-specific and strongly supported.",
  10: "Exceptionally well supported with no meaningful inconsistency.",
};

/** The model-generated body of part 2: scores only, no prose. */
export const evaluationScoresSchema = z.object({
  character_consistency: scoreSchema,
  situation_fit: scoreSchema,
  state_memory_alignment: scoreSchema,
});

export type EvaluationScores = z.infer<typeof evaluationScoresSchema>;

/**
 * The mean of the three dimensions.
 *
 * Computed here rather than asked for: a model that reports its own average
 * gets to disagree with its own scores, and an average that does not follow
 * from the numbers beside it is worse than no average at all.
 */
export function overallScore(scores: EvaluationScores): number {
  return (
    (scores.character_consistency +
      scores.situation_fit +
      scores.state_memory_alignment) /
    3
  );
}

/** The persisted judgement of one flow's predicted action. */
export const evaluationSchema = z.object({
  profile_id: z.string(),
  scenario_id: z.string(),
  flow_key: z.string(),
  /** Copied from the scenario so listings render without reading Stage 2 too. */
  name: z.string(),
  scenario_title: z.string(),
  scores: evaluationScoresSchema,
  /** Derived from `scores` by `overallScore`, stored so listings can sort. */
  overall_score: z.number(),
  /**
   * The top of the scale these scores were taken on. Defaulted rather than
   * required, so evaluations written before the scale was versioned parse as
   * the 1-5 they actually were instead of being silently read as 1-10.
   */
  score_scale: z.number().int().min(2).default(5),
  /**
   * The action that was scored, snapshotted. A prediction is re-runnable, and a
   * score whose action had changed underneath it would be attributed to text
   * the evaluator never saw.
   */
  action: z.string(),
  /** The mode the evaluation context ran in — which memories the judge had. */
  decision_mode: decisionModeSchema,
  /** When the evaluation context this scored against was built. */
  context_generated_at: z.string(),
  /** When the flow produced the action, from its own decision step. */
  action_generated_at: z.string(),
  generated_at: z.string(),
  model: z.string(),
});

export type Evaluation = z.infer<typeof evaluationSchema>;
