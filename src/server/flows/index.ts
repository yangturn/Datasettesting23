import "server-only";

import type { Scenario } from "@/lib/stage-2";
import { situationTypeSchema } from "@/lib/stage-2";
import type { FlowMeta } from "@/lib/stage-3";
import { directZeroShotFlow } from "@/server/flows/direct-zero-shot";
import { fullFlowFirstPersonFlow } from "@/server/flows/full-flow-first-person";
import { fullFlowV2Flow } from "@/server/flows/full-flow-v2";
import { herDualLayeredThinkingFlow } from "@/server/flows/her-dual-layered-thinking";
import { omCotFlow } from "@/server/flows/om-cot";
import type { Flow } from "@/server/flows/types";

/**
 * Every flow Stage 3 can run, in the order the page lists them.
 *
 * Adding a flow is adding a module here. Flows are code rather than config
 * because a step is a prompt, an output schema, and a builder that reads the
 * outputs of earlier steps — the last of which cannot be expressed as data.
 */
/**
 * Two flows are deliberately absent, and neither module is dead.
 *
 * `full_flow` is replaced by `full_flow_v2` as the third-person arm, and
 * `immediate_flow` is no longer run as an arm of its own. `full-flow.ts` still
 * holds the reflective pipeline and parts 4 and 5, which v2 and the
 * first-person flow are built on; `immediate-flow.ts` still holds the immediate
 * pipeline, which both of those flows fall back to on a time-sensitive
 * scenario. What was removed in each case is the column, not the parts.
 *
 * Executions already on disk under either key are reported as orphaned rather
 * than erroring, so removing them here costs nothing but a stale-row count
 * until the grid is regenerated.
 */
export const FLOWS: Flow[] = [
  fullFlowV2Flow,
  fullFlowFirstPersonFlow,
  herDualLayeredThinkingFlow,
  directZeroShotFlow,
  omCotFlow,
];

/**
 * A stand-in scenario for exercising a flow's branches at load.
 *
 * Empty everywhere it can be: the checks below look only at which steps a branch
 * returns, and a probe carrying plausible-looking content would invite branches
 * that read it. `situation_type` is the one field the caller varies.
 */
const PROBE_SCENARIO: Scenario = {
  id: "probe",
  profile_id: "probe",
  name: "",
  headline: "",
  title: "",
  situation_type: "NORMAL",
  life_domain: null,
  situation: "probe",
  context: {},
  context_generated_at: null,
  description_generated_at: "",
  generated_at: "",
  model: "",
};

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

    /**
     * A branching flow is checked against one scenario of each situation type.
     *
     * Only the situation type is varied because that is the only thing a branch
     * may read — `stepsFor` is handed a scenario so it can look at how the
     * moment is shaped, not so it can inspect a particular person's context. A
     * branch is therefore fully covered by three probes.
     *
     * What is being checked is that every branch stays within the steps the flow
     * declares. A branch returning an undeclared step key would run and persist
     * fine, and then be invisible: the page's legend, the outcome lookup, and
     * `flowMeta` all read `steps`, so the part would do work nothing displays.
     */
    if (flow.stepsFor) {
      for (const situationType of situationTypeSchema.options) {
        const declared = new Map(flow.steps.map((step) => [step.key, step]));
        const branch = flow.stepsFor({
          ...PROBE_SCENARIO,
          situation_type: situationType,
        });

        if (branch.length === 0) {
          throw new Error(
            `Flow "${flow.key}" returns no steps for a ${situationType} scenario.`,
          );
        }

        for (const step of branch) {
          const match = declared.get(step.key);
          if (!match) {
            throw new Error(
              `Flow "${flow.key}" runs step "${step.key}" on a ${situationType} scenario but does not declare it in "steps", so nothing would render it.`,
            );
          }
          // Same key, different fields would make one branch's record
          // unreadable by the page, which lays cells out from the declared
          // step's fields.
          const fields = match.fields.map((field) => field.key).join(",");
          if (step.fields.map((field) => field.key).join(",") !== fields) {
            throw new Error(
              `Flow "${flow.key}" runs a step keyed "${step.key}" on a ${situationType} scenario whose fields differ from the declared step of that key.`,
            );
          }
        }
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
