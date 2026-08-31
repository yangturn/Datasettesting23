import "server-only";

import type { FlowMeta } from "@/lib/stage-3";
import { fullFlow } from "@/server/flows/full-flow";
import { immediateFlow } from "@/server/flows/immediate-flow";
import type { Flow } from "@/server/flows/types";

/**
 * Every flow Stage 3 can run, in the order the page lists them.
 *
 * Adding a flow is adding a module here. Flows are code rather than config
 * because a step is a prompt, an output schema, and a builder that reads the
 * outputs of earlier steps — the last of which cannot be expressed as data.
 */
export const FLOWS: Flow[] = [fullFlow, immediateFlow];

/**
 * Flow keys become directory-safe filenames and the client's selection values,
 * so they are checked here rather than at each use. A duplicate would make two
 * flows overwrite each other's executions; an odd character would make the path
 * check reject every write at runtime, long after the mistake was made.
 */
{
  const seen = new Set<string>();
  for (const flow of FLOWS) {
    if (!/^[a-z0-9_-]+$/.test(flow.key)) {
      throw new Error(`Flow key "${flow.key}" must match [a-z0-9_-].`);
    }
    if (seen.has(flow.key)) {
      throw new Error(`Duplicate flow key "${flow.key}".`);
    }
    seen.add(flow.key);

    if (flow.steps.length === 0) {
      throw new Error(`Flow "${flow.key}" has no steps.`);
    }

    const steps = new Set<string>();
    for (const step of flow.steps) {
      if (steps.has(step.key)) {
        throw new Error(
          `Flow "${flow.key}" has two steps keyed "${step.key}"; the second would overwrite the first in the execution record.`,
        );
      }
      steps.add(step.key);

      if (step.fields.length === 0) {
        throw new Error(`Step "${flow.key}/${step.key}" declares no fields.`);
      }
    }

    // An outcome that points nowhere would leave the page silently showing no
    // prediction for a flow that produces one, which reads as a failed run.
    if (flow.outcome) {
      const step = flow.steps.find(
        (candidate) => candidate.key === flow.outcome!.stepKey,
      );
      if (!step) {
        throw new Error(
          `Flow "${flow.key}" names outcome step "${flow.outcome.stepKey}", which it does not have.`,
        );
      }
      if (!step.fields.some((field) => field.key === flow.outcome!.fieldKey)) {
        throw new Error(
          `Flow "${flow.key}" names outcome field "${flow.outcome.fieldKey}", which step "${step.key}" does not produce.`,
        );
      }
    }
  }
}

export function flowByKey(key: string): Flow | undefined {
  return FLOWS.find((flow) => flow.key === key);
}

/** The flows as the page sees them — no prompts, no schemas, no builders. */
export function flowMeta(): FlowMeta[] {
  return FLOWS.map((flow) => ({
    key: flow.key,
    label: flow.label,
    description: flow.description,
    steps: flow.steps.map((step) => ({
      key: step.key,
      label: step.label,
      description: step.description,
      fields: step.fields,
    })),
    outcome: flow.outcome ?? null,
  }));
}
