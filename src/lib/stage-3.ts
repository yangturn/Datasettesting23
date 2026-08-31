import { z } from "zod";

/**
 * Stage 3 — flow execution.
 *
 * A *flow* is one candidate character-decision model: an ordered pipeline of
 * model calls that reads a Stage 2 scenario and works toward a prediction of
 * what the person does. Stage 3 runs every flow over every scenario, so the
 * flows can be compared against each other on identical input.
 *
 * A flow is not a single call and not a prompt variant. It has *steps*, each
 * with its own system prompt, its own output fields, and access to the outputs
 * of the steps before it. The flows themselves live in `src/server/flows/`
 * rather than in a JSON config, because a step is a prompt plus a schema plus a
 * prompt builder that reads prior steps — none of which survives being written
 * as data. This file holds only what both the server and the page need: the
 * shape of what gets persisted, and the metadata the page renders.
 *
 * One execution is one (scenario × flow) cell, at
 * `data/executions/<profile_id>/<scenario_id>/<flow_key>.json`, and it is
 * rewritten after every step. A flow whose later step fails therefore keeps the
 * steps already paid for, and re-running resumes from the first missing one —
 * the same bargain Stage 2 makes between its situation call and its context
 * call.
 */

/**
 * One field a step emits. Steps produce flat maps of strings: every prompt in
 * this project asks for prose per key, and keeping the shape uniform is what
 * lets the page render a step it has never heard of.
 */
export type FlowFieldMeta = {
  key: string;
  label: string;
  /**
   * How the page lays the value out. `facts` is a list — one short statement
   * per line, which is what an extraction step returns. `prose` is a written
   * account, where blank lines separate paragraphs and an all-caps line is a
   * section heading. `value` is a single token from a closed set, shown inline
   * as a badge. Rendering prose as a list of lines is unreadable, rendering
   * facts as a paragraph runs them together, and burying a one-word verdict
   * behind a disclosure triangle hides the most scannable thing a step
   * produces.
   */
  render: "facts" | "prose" | "value";
  /**
   * The closed set of answers this field may take, when it has one. Present
   * makes the field an enum: the step's schema rejects anything else, so a
   * near-miss like "mostly retained" becomes a corrective retry rather than a
   * value nothing downstream can group by.
   */
  values?: readonly [string, ...string[]];
};

/** A step as the page sees it — no prompts, no schema, no builder. */
export type FlowStepMeta = {
  key: string;
  label: string;
  /** What this step is for, in the page's words. The model never sees it. */
  description: string;
  fields: FlowFieldMeta[];
};

/**
 * Which field carries a flow's actual claim, out of everything its parts
 * produce. Optional: a flow that is all intermediate work has no single answer
 * to point at.
 */
export type FlowOutcome = {
  stepKey: string;
  fieldKey: string;
};

/** A flow as the page sees it. */
export type FlowMeta = {
  key: string;
  label: string;
  description: string;
  steps: FlowStepMeta[];
  outcome: FlowOutcome | null;
};

/** One completed step of an execution. */
export const executionStepSchema = z.object({
  /**
   * The step's output, keyed by its declared field keys. Values may be empty:
   * the prompts allow a field to come back blank when the source material does
   * not support it, and rejecting that would turn an honest blank into a retry
   * loop.
   */
  output: z.record(z.string(), z.string()),
  generated_at: z.string(),
  /** Recorded per step, since a flow may yet mix models across its steps. */
  model: z.string(),
});

export type ExecutionStep = z.infer<typeof executionStepSchema>;

/** The persisted cell: one flow's progress through one scenario. */
export const executionSchema = z.object({
  flow_key: z.string(),
  profile_id: z.string(),
  scenario_id: z.string(),
  /** Copied from the scenario so the grid renders without reading Stage 2 too. */
  name: z.string(),
  scenario_title: z.string(),
  /**
   * Completed steps, keyed by step key. A key that is absent has not run —
   * which is how a resumed run knows what is left, and how adding a new step to
   * a flow makes every existing execution incomplete rather than stale.
   */
  steps: z.record(z.string(), executionStepSchema),
  /**
   * When the scenario was created, and when its context call finished.
   *
   * Both, because Stage 2 writes a scenario twice: once with the situation
   * alone, and again once the context lands. Only the second write moves
   * `context_generated_at`, so an execution built from the half-written
   * scenario is stale the moment the context arrives, and comparing
   * `generated_at` alone would never notice.
   */
  scenario_generated_at: z.string(),
  scenario_context_generated_at: z.string(),
  /**
   * When the Stage 1 description used as the biography was generated. A
   * regenerated description is a different person on the same id, and every
   * attribute extracted from the old one describes someone else.
   */
  description_generated_at: z.string(),
  started_at: z.string(),
  /** Moved by every step, so the newest write is visible without reading steps. */
  updated_at: z.string(),
});

export type Execution = z.infer<typeof executionSchema>;
