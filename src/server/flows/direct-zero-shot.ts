import "server-only";

import {
  ALL_CONTEXT_KEYS,
  availableMemories,
  contextBlock,
  STEP_DECISION,
} from "@/server/flows/shared";
import type { Flow, FlowStep, StepInput } from "@/server/flows/types";

/**
 * Direct Zero Shot — one call, straight from the profile to the action.
 *
 * The baseline of the comparison. Every other flow argues that a prediction
 * improves when the work is broken into parts — extraction, consolidation, fast
 * appraisal, deliberate reappraisal, or an outside/inside split of the reasoning.
 * This flow is what that claim is measured against: the same canonical material,
 * the same output fields, no intermediate stages at all.
 *
 * Its prompt therefore forbids in the model what the other flows achieve through
 * structure — no appraisal, no reappraisal, no option analysis, no multi-stage
 * decision process, no chain of thought. Without that, a single call would
 * simply perform the other flows' pipeline inline and the comparison would be
 * between one model doing the stages silently and several models doing them on
 * the record, rather than between staged and unstaged prediction.
 *
 * One step, keyed `decision` and producing `action` and `explanation`, so
 * `decision.action` means the same thing here as in every other flow.
 */

const DIRECT_ZERO_SHOT_SYSTEM = `You predict a character’s next behavior from their established profile, history, and current situation.

Use the supplied character description, relationship profiles, behavioral tendencies, current state, and available memories to predict one concrete action.

Rules:
- Treat all supplied information as canonical.
- Use only the supplied evidence; do not invent facts, relationships, motives, memories, or constraints.
- Predict one specific, observable action that directly responds to the situation.
- Do not generate an appraisal, reappraisal, option analysis, or multi-stage decision process.
- Do not describe several possible actions.
- The action must be feasible under the situation’s timing and practical constraints.
- Prefer character-consistent behavior over generic rationality, morality, politeness, or optimality.
- The explanation must briefly identify the strongest character-specific evidence supporting the action.
- Do not introduce reasons that are absent from the supplied context.
- Do not describe hidden reasoning or a chain of thought.
- Refer to the character in the third person.
- Return exactly one JSON object with no additional prose.

Return:

{
  "action": "",
  "explanation": ""
}`;

function buildDirectZeroShotPrompt(input: StepInput): string {
  return `Character description:

"""
${input.description.description}
"""

Current situation:

"""
${input.scenario.situation}
"""

Relationship profiles:

"""
${contextBlock(input, "relationship_profiles")}
"""

Established tendencies:

"""
${contextBlock(input, "tendencies")}
"""

Current state:

"""
${contextBlock(input, "current_state")}
"""

Available memories:

"""
${availableMemories(input)}
"""

Predict the character’s next action.

The action must be concrete and observable. Explain it briefly using only the strongest relevant evidence from the supplied context.

Return JSON only:

{
  "action": "",
  "explanation": ""
}`;
}

/**
 * The flow's only part, and therefore its output.
 *
 * `requiresContext` names all five Stage 2 blocks: four are read directly, and
 * reflective memories are read for every situation type but TIME_SENSITIVE.
 */
const directZeroShotStep: FlowStep = {
  key: STEP_DECISION,
  label: "Behavior prediction",
  description:
    "Predicts one concrete, observable action in a single call, straight from the biography, the situation, and the episode context. The prompt forbids the staged reasoning the other flows perform — no appraisal, no reappraisal, no weighing of options, no chain of thought — and asks only for the action plus the strongest character-specific evidence behind it.",
  requiresContext: ALL_CONTEXT_KEYS,
  fields: [
    { key: "action", label: "Action", render: "prose" },
    { key: "explanation", label: "Explanation", render: "prose" },
  ],
  system: DIRECT_ZERO_SHOT_SYSTEM,
  buildPrompt: buildDirectZeroShotPrompt,
};

export const directZeroShotFlow: Flow = {
  key: "direct_zero_shot",
  label: "Direct Zero Shot",
  description:
    "The unstaged baseline: one call from the profile, situation, and episode context to a single concrete action, with staged reasoning explicitly forbidden. Reflective memories are withheld when the situation is time-sensitive.",
  steps: [directZeroShotStep],
  outcome: {
    stepKey: STEP_DECISION,
    fieldKey: "action",
    reasonKey: "explanation",
  },
};
