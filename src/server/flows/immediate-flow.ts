import "server-only";

import {
  appraisalStep,
  consolidateStep,
  makeAttributesStep,
  priorField,
  priorStepBlock,
  STEP_CONSOLIDATE,
  STEP_DECISION,
} from "@/server/flows/shared";
import type { Flow, FlowStep, StepInput } from "@/server/flows/types";

/**
 * Immediate Flow — the same character decision model without reflection.
 *
 * Parts 1 to 3 are the shared spine, identical to Full Flow's in every respect
 * but one: reflective memories are withheld from part 1 as well as from parts 2
 * and 3. The flow then decides straight off the fast appraisal, with no
 * deliberate reappraisal in between.
 *
 * Withholding them at part 1 is what makes the pair a real comparison. Part 1
 * extracts *attributes*, and an attribute drawn from a reflective memory is
 * indistinguishable from one drawn from the biography by the time part 2 has
 * consolidated it — the material would reach this flow's decision through the
 * side door while the prompts all state the character has no access to it. That
 * is not hypothetical: in the first Full Flow run, part 1 lifted a phrase that
 * appears only in the reflective memories into its output.
 *
 * The consequence is that this flow's parts 1 to 3 produce different *content*
 * than Full Flow's, despite parts 2 and 3 being the same prompts. That is the
 * intended reading of "does not use reflective memories": the difference between
 * the flows is reflection, wherever it would otherwise leak in, rather than the
 * presence of one extra step.
 */

const attributesStep = makeAttributesStep(false);

const IMMEDIATE_DECISION_SYSTEM = `You generate and explain a character’s immediate behavioral response for a behavioral-prediction benchmark.

You are given the character’s consolidated initial context and initial appraisal. The situation requires an immediate or near-immediate response, so the character acts without deliberate reflection or access to reflective memories.

Determine what the character actually does or says based on their initial interpretation, emotional reaction, activated concerns, automatic assumptions, and initial action tendency.

Rules:
- Treat all supplied information as canonical.
- Select the single most plausible immediate response for this character.
- Base the response only on the consolidated initial context and initial appraisal.
- Do not introduce, reconstruct, or use reflective memories.
- Do not perform reflective reappraisal, extended deliberation, or systematic comparison of alternatives.
- Do not calculate distant or detailed consequences.
- Give substantial weight to established tendencies, habits, current state, immediate memories, and the initial action tendency.
- The final response may be impulsive, habitual, emotionally influenced, incomplete, or imperfect.
- Do not assume the character acts optimally, morally, rationally, or consistently.
- The character may hesitate briefly, use a familiar social script, or make a rapid compromise when this fits the available time.
- Do not invent new facts, events, relationships, memories, options, resources, or reactions from other people.
- Stay within the opportunities and constraints established by the situation.
- Do not list alternative actions or continue the scene beyond the character’s immediate response.
- Refer to the character in the third person.
- Return exactly one JSON object with no additional prose.

Field definitions:

action:
Describe only the character’s immediate, externally observable behavior. Include what the character says when relevant. Do not include hidden thoughts, emotions, motives, or reasoning.

explanation:
Explain why this immediate response is most plausible based on the supplied initial context and appraisal. Identify the strongest immediate influences, such as an activated habit, emotional reaction, relationship expectation, current condition, directly cued memory, or initial action tendency. Do not introduce reflective reasoning or information unavailable at the moment.`;

function buildImmediateDecisionPrompt(input: StepInput): string {
  return `Consolidated initial context:

"""
${priorField(input, STEP_CONSOLIDATE, "initial_context")}
"""

Initial appraisal:

"""
${priorStepBlock(input, appraisalStep)}
"""

The situation requires an immediate or near-immediate response. Generate what the character does or says without reflective memories or deliberate reappraisal.

Return JSON only:

{
  "action": "",
  "explanation": ""
}`;
}

/**
 * Part 4 — the immediate decision, straight off the fast appraisal.
 *
 * Keyed `decision` like Full Flow's final part, and producing the same two
 * fields, so `decision.action` means the same thing in both flows and an
 * evaluation stage can compare them without a per-flow mapping.
 */
const immediateDecisionStep: FlowStep = {
  key: STEP_DECISION,
  label: "Immediate decision",
  description:
    "Commits to what the person does or says with no time to reflect, weighting habits, current state, cued memories, and the first impulse. The response may be impulsive, habitual, or imperfect; reflective memories and deliberate reappraisal are explicitly out of reach.",
  requiresContext: [],
  fields: [
    { key: "action", label: "Action", render: "prose" },
    { key: "explanation", label: "Explanation", render: "prose" },
  ],
  system: IMMEDIATE_DECISION_SYSTEM,
  buildPrompt: buildImmediateDecisionPrompt,
};

export const immediateFlow: Flow = {
  key: "immediate_flow",
  label: "Immediate Flow",
  description:
    "The same model without reflection: extract, consolidate, appraise fast, then act. Reflective memories are withheld throughout, and there is no deliberate reappraisal.",
  steps: [attributesStep, consolidateStep, appraisalStep, immediateDecisionStep],
  outcome: {
    stepKey: STEP_DECISION,
    fieldKey: "action",
    reasonKey: "explanation",
  },
};
