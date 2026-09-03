import "server-only";

import { z } from "zod";

import type { Description } from "@/lib/stage-1";
import type { Scenario } from "@/lib/stage-2";
import type { FlowFieldMeta, FlowOutcome } from "@/lib/stage-3";

/**
 * What a flow step is given when its prompt is built.
 *
 * `prior` holds the outputs of the steps that already ran in this flow, keyed by
 * step key then field key. That is the whole reason flows are pipelines rather
 * than single calls: a later step reads what an earlier one extracted, instead
 * of re-deriving it from the raw scenario.
 */
export type StepInput = {
  scenario: Scenario;
  /** The Stage 1 description, used as the biography. */
  description: Description;
  prior: Record<string, Record<string, string>>;
};

export type FlowStep = {
  key: string;
  label: string;
  /** What this step is for, shown on the page. The model never sees it. */
  description: string;
  /**
   * Stage 2 context keys this step's prompt reads. Declared rather than
   * discovered, so a flow whose inputs `data/stage-2-fields.json` no longer
   * defines is refused up front instead of quietly running on blank blocks.
   */
  requiresContext: string[];
  /** The JSON keys this step must return, in the order the page shows them. */
  fields: FlowFieldMeta[];
  system: string;
  buildPrompt: (input: StepInput) => string;
};

export type Flow = {
  key: string;
  label: string;
  description: string;
  /**
   * Every step this flow can run, in order — the union of its branches, not
   * necessarily what any one scenario gets.
   *
   * This is the flow as described rather than as executed: the page's legend,
   * the registry's validation, and `flowMeta` all read it, so it must name every
   * step key a branch can produce. What a *particular* scenario runs comes from
   * `stepsFor`.
   */
  steps: FlowStep[];
  /**
   * The steps this scenario actually gets, when the flow branches on it.
   *
   * Omitted by a flow that runs the same pipeline every time — the common case,
   * and `flowStepsFor` falls back to `steps` for it. A branching flow must
   * return steps whose keys are all declared in `steps`, which the registry
   * checks at load against one scenario of each situation type.
   *
   * Two branches may share a step key while differing in prompt: that is how a
   * flow substitutes a variant of a part rather than dropping it. Keys and
   * fields are what the execution record and the page are keyed by, so a
   * substituted step stays comparable with the one it replaces.
   */
  stepsFor?: (scenario: Scenario) => FlowStep[];
  /**
   * The step and field holding what this flow ultimately claims — the thing a
   * reader wants first and an evaluation stage would score. Omitted by a flow
   * that produces no single answer.
   */
  outcome?: FlowOutcome;
};

/**
 * The steps a flow runs for one scenario.
 *
 * Every scenario-scoped reader goes through this rather than `flow.steps` — the
 * planner, the runner, the grid, and the coverage totals. Reading `flow.steps`
 * directly where a scenario is in hand is the bug this exists to prevent: a
 * branching flow would be scheduled for four parts and then reported as four of
 * five done, so the grid could never read complete and every run would find work
 * left to do.
 */
export function flowStepsFor(flow: Flow, scenario: Scenario): FlowStep[] {
  return flow.stepsFor ? flow.stepsFor(scenario) : flow.steps;
}

/**
 * A pipeline with some of its parts swapped for variants, keyed by step key.
 *
 * How a flow that is a *variation* of another one is built: it takes the base
 * flow's own step objects and replaces only the parts it actually rewrote, so
 * everything it has not deliberately changed stays literally the same object
 * rather than a copy that drifts. A step key with no override passes through
 * untouched.
 *
 * Applied to every branch a flow runs, so a rewritten part is rewritten
 * everywhere — otherwise a flow would quietly use the base version of a part on
 * whichever situation types take a different branch.
 */
export function substituteSteps(
  steps: FlowStep[],
  overrides: Map<string, FlowStep>,
): FlowStep[] {
  return steps.map((step) => overrides.get(step.key) ?? step);
}

/**
 * A step's output schema, built from its declared fields: every key must be
 * present, so a dropped field is a schema error the client's corrective retry
 * can fix rather than a step silently missing half its output. Values may be
 * empty — the prompts explicitly allow a blank field where the source material
 * does not support one.
 */
export function stepSchema(step: FlowStep) {
  return z.object(
    Object.fromEntries(
      step.fields.map((field) => [
        field.key,
        // A field with a declared value set is an enum, not free text. Enum
        // members are strings, so the persisted record stays a flat string map
        // either way.
        field.values ? z.enum(field.values) : z.string(),
      ]),
    ),
  );
}
