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
 * view; anything else narrows to one Stage 2 situation type, or to a named
 * group of them.
 *
 * The comparison this exists for is whether reflection earns its keep where
 * there is time to reflect. TIME_SENSITIVE is exactly where it should not —
 * that type forces IMMEDIATE mode, so the evaluator judges both flows without
 * reflective memories — and an average taken across all three types hides that.
 * `NORMAL_AND_CULTURE` is the other half of that cut: every situation that did
 * run in REFLECTIVE mode, pooled, so the two sides can be read off one page
 * without averaging the reflective cases against the ones they are contrasted
 * with.
 *
 * The single types are derived from Stage 2's enum rather than restated, so a
 * new situation type becomes filterable instead of silently falling only into
 * `ALL`.
 */
export const SITUATION_FILTER_GROUP_KEYS = ["NORMAL_AND_CULTURE"] as const;

export const SITUATION_FILTERS = [
  "ALL",
  ...situationTypeSchema.options,
  ...SITUATION_FILTER_GROUP_KEYS,
] as const;

export type SituationFilter = (typeof SITUATION_FILTERS)[number];

export type SituationFilterGroup =
  (typeof SITUATION_FILTER_GROUP_KEYS)[number];

/** The situation types each grouped filter stands for. */
export const SITUATION_FILTER_GROUPS: Record<
  SituationFilterGroup,
  readonly SituationType[]
> = {
  NORMAL_AND_CULTURE: ["NORMAL", "CULTURE_RELEVANT"],
};

/**
 * The situation types a filter admits, or `undefined` for no filter at all.
 * One shape for every chip, so callers never special-case the groups.
 */
export function situationTypesFor(
  filter: SituationFilter,
): SituationType[] | undefined {
  if (filter === "ALL") return undefined;
  if (filter in SITUATION_FILTER_GROUPS) {
    return [...SITUATION_FILTER_GROUPS[filter as SituationFilterGroup]];
  }
  return [filter as SituationType];
}

/** Short labels for the filter chips. The stored values stay canonical. */
export const SITUATION_FILTER_LABELS: Record<SituationFilter, string> = {
  ALL: "All",
  NORMAL: "Normal",
  CULTURE_RELEVANT: "Culture",
  TIME_SENSITIVE: "Time-sensitive",
  NORMAL_AND_CULTURE: "Normal + Culture",
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
      "Does the action fit the character description, relationship profiles, and established behavioral tendencies?",
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
      "Does the action fit the character’s current emotional, physical, and cognitive state and the memories available in the evaluation context?",
  },
  {
    key: "action_plausibility",
    label: "Action plausibility",
    question:
      "Considering all available evidence together, is the action a believable response for this particular character? The action does not need to be optimal, uniquely correct, or perfectly consistent.",
  },
  {
    key: "reasoning_coherence",
    label: "Reasoning coherence",
    question:
      "Does the generated reason provide a coherent and grounded explanation of how the available character and situational evidence led to the final action? For a reflective decision, does it explain how deliberation retained, strengthened, softened, or reversed the initial tendency?",
  },
] as const;

export type ScoreDimensionKey = (typeof SCORE_DIMENSIONS)[number]["key"];

/**
 * Bumped whenever `SCORE_DIMENSIONS` changes. The scale can stay 1-10 while the
 * questions behind the numbers change, and scores taken against a different set
 * of questions are no more comparable than scores taken on a different scale —
 * so they are versioned the same way and excluded from the same averages.
 */
export const SCORE_DIMENSION_SET = 3;

/** What each point on the scale means. */
export const SCORE_SCALE: Record<number, string> = {
  1: "Directly contradicted, unsupported, or incoherent.",
  2: "Strongly inconsistent with the relevant evidence.",
  3: "Weakly supported with major inconsistencies.",
  4: "More inconsistent than consistent.",
  5: "Neutral, underdetermined, or only minimally grounded.",
  6: "Generally plausible or coherent with noticeable weaknesses.",
  7: "Clearly plausible or coherent and adequately grounded.",
  8: "Strongly plausible or coherent and well grounded.",
  9: "Very strongly aligned with the relevant evidence.",
  10: "Exceptionally well supported with no meaningful inconsistency.",
};

/** The model-generated body of part 2: scores only, no prose. */
export const evaluationScoresSchema = z.object({
  character_consistency: scoreSchema,
  situation_fit: scoreSchema,
  state_memory_alignment: scoreSchema,
  action_plausibility: scoreSchema,
  reasoning_coherence: scoreSchema,
});

export type EvaluationScores = z.infer<typeof evaluationScoresSchema>;

/**
 * Scores as they are read back off disk.
 *
 * Loose where `evaluationScoresSchema` is strict: an evaluation written against
 * an older dimension set carries older keys, and refusing to parse it would
 * take the whole page down over rows that only need re-running. They are read,
 * marked by their `dimension_set`, and left out of the averages.
 */
export const storedScoresSchema = z.record(z.string(), scoreSchema);

/**
 * The mean of the scored dimensions.
 *
 * Computed here rather than asked for: a model that reports its own average
 * gets to disagree with its own scores, and an average that does not follow
 * from the numbers beside it is worse than no average at all.
 */
export function overallScore(scores: EvaluationScores): number {
  const total = SCORE_DIMENSIONS.reduce(
    (sum, dimension) => sum + scores[dimension.key],
    0,
  );
  return total / SCORE_DIMENSIONS.length;
}

/** The persisted judgement of one flow's predicted action. */
export const evaluationSchema = z.object({
  profile_id: z.string(),
  scenario_id: z.string(),
  flow_key: z.string(),
  /** Copied from the scenario so listings render without reading Stage 2 too. */
  name: z.string(),
  scenario_title: z.string(),
  scores: storedScoresSchema,
  /** Derived from `scores` by `overallScore`, stored so listings can sort. */
  overall_score: z.number(),
  /**
   * The top of the scale these scores were taken on. Defaulted rather than
   * required, so evaluations written before the scale was versioned parse as
   * the 1-5 they actually were instead of being silently read as 1-10.
   */
  score_scale: z.number().int().min(2).default(5),
  /**
   * The dimension set these scores answer. Defaulted for the same reason as the
   * scale: evaluations written before the dimensions were versioned parse as
   * the three-dimension judgements they actually were.
   */
  dimension_set: z.number().int().min(1).default(1),
  /**
   * The action that was scored, snapshotted. A prediction is re-runnable, and a
   * score whose action had changed underneath it would be attributed to text
   * the evaluator never saw.
   */
  action: z.string(),
  /**
   * The reason that was scored, snapshotted beside the action for the same
   * reason. Defaulted: evaluations written before the reason was judged carry
   * no copy of it, and an absent reason is not an empty one.
   */
  reason: z.string().default(""),
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
