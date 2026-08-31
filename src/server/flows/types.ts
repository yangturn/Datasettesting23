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
  /** Run in order; each step sees the outputs of the ones before it. */
  steps: FlowStep[];
  /**
   * The step and field holding what this flow ultimately claims — the thing a
   * reader wants first and an evaluation stage would score. Omitted by a flow
   * that produces no single answer.
   */
  outcome?: FlowOutcome;
};

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
