import "server-only";

import {
  appraisalStep,
  consolidateStep,
  contextBlock,
  makeAttributesStep,
  priorField,
  priorStepBlock,
  STEP_CONSOLIDATE,
  STEP_DECISION,
} from "@/server/flows/shared";
import type { Flow, FlowStep, StepInput } from "@/server/flows/types";

/**
 * Full Flow — the character decision model with deliberate reflection.
 *
 * Parts 1 to 3 are the shared spine (see `shared.ts`): extract what is stable
 * about the person, consolidate it with the moment, then appraise it fast. What
 * distinguishes this flow is what comes after — a deliberate reappraisal with
 * reflective memories in hand, and a decision that weighs it.
 *
 * Reflective memories reach part 1 here and are then withheld until part 4, so
 * the fast appraisal in part 3 genuinely lacks what reflection later supplies.
 * Immediate Flow is the same spine without any of that, which is what makes the
 * pair a comparison of reflection rather than of two unrelated pipelines.
 *
 * Later parts read earlier ones through `input.prior.<step key>`.
 */

const STEP_REAPPRAISAL = "reappraisal";

const attributesStep = makeAttributesStep(true);

const REAPPRAISAL_SYSTEM = `You simulate a character’s deliberate reappraisal of a situation for a behavioral-prediction benchmark.

You are given:

1. The consolidated context available during the initial appraisal.
2. The character’s initial appraisal and action tendency.
3. Reflective memories that become accessible through deliberate thought.

Reconsider the situation from the character’s subjective perspective using all information now available. Integrate the objective situation, relationships, tendencies, current state, immediate memories, initial appraisal, and reflective memories.

Reflective memories provide new evidence, but they are not the sole basis of deliberation.

Rules:
- Treat all supplied information as canonical.
- Ground every conclusion in the supplied context, initial appraisal, or reflective memories.
- Do not invent biography, events, relationships, memories, values, goals, capabilities, or constraints.
- Preserve the initial appraisal as the character’s genuine first reaction.
- Consider the main plausible responses and their personally meaningful consequences.
- Consider practical constraints, timing, uncertainty, reversibility, and relationship consequences when relevant.
- Determine which considerations matter most to this particular character.
- Do not assume that deliberation makes the character more rational, moral, polite, cautious, or socially desirable.
- Emotions, habits, relationships, fatigue, and biases may continue to influence deliberation.
- Do not assume that reflection changes the initial tendency.
- Explicitly state whether the initial tendency is retained, strengthened, softened, or reversed.
- If it changes, identify which considerations caused the change.
- If it remains, explain what reinforces it.
- Preserve uncertainty or conflict when the evidence does not clearly resolve it.
- Do not perform the final action.
- The revised action tendency remains provisional.
- Refer to the character in the third person.
- Return exactly one JSON object with no additional prose.

Field definitions:

initial_tendency:
Restate the character’s initial provisional impulse without changing its meaning.

reflective_update:
Describe the character’s broader deliberation using the complete available context: the objective situation, relationships, tendencies, current state, immediate memories, initial appraisal, and reflective memories. Briefly compare the main plausible responses and their personally meaningful consequences. Identify which considerations reinforce or change the initial tendency.

change_from_initial:
Return exactly one value:
- RETAINED
- STRENGTHENED
- SOFTENED
- REVERSED

reconsidered_interpretation:
Describe how the character understands the situation after deliberation. State how this reinforces, qualifies, or revises the initial interpretation.

motivational_conflict:
Describe the principal tension among the character’s relationships, tendencies, current state, concerns, and anticipated consequences. Do not manufacture conflict when the evidence points consistently in one direction.

revised_action_tendency:
State the character’s inclination after deliberation. Connect it to the considerations that carried the most weight without performing the final action.`;

function buildReappraisalPrompt(input: StepInput): string {
  return `Consolidated initial context:

"""
${priorField(input, STEP_CONSOLIDATE, "initial_context")}
"""

Initial appraisal:

"""
${priorStepBlock(input, appraisalStep)}
"""

Reflective memories:

"""
${contextBlock(input, "reflective_memories")}
"""

Generate the character’s deliberate reappraisal.

Use the complete available context, not only the reflective memories. Explain whether deliberation retains, strengthens, softens, or reverses the initial tendency.

Do not invent information or perform the final action.

Return JSON only:

{
  "initial_tendency": "",
  "reflective_update": "",
  "change_from_initial": "RETAINED",
  "reconsidered_interpretation": "",
  "motivational_conflict": "",
  "revised_action_tendency": ""
}`;
}

/**
 * Part 4 — deliberate reappraisal, and the only part that sees reflective
 * memories after part 1.
 *
 * `initial_appraisal` is one placeholder in the supplied prompt, but part 3
 * produces five fields, so they are laid out under their own keys — see
 * `priorStepBlock`.
 */
const reappraisalStep: FlowStep = {
  key: STEP_REAPPRAISAL,
  label: "Reflective reappraisal",
  description:
    "Reconsiders the moment with reflective memories in hand, deliberating over the whole available context rather than the new memories alone: it restates the first impulse, weighs the main plausible responses and their consequences, and commits to whether deliberation retained, strengthened, softened, or reversed it. Deliberation is not assumed to make the person more rational or agreeable, and the revised inclination stays provisional.",
  requiresContext: ["reflective_memories"],
  fields: [
    { key: "initial_tendency", label: "Initial tendency", render: "prose" },
    { key: "reflective_update", label: "Reflective update", render: "prose" },
    {
      key: "change_from_initial",
      label: "Change from initial",
      render: "value",
      // Closed set, so the schema rejects a near-miss and the page can group
      // runs by whether reflection actually moved anything.
      values: ["RETAINED", "STRENGTHENED", "SOFTENED", "REVERSED"],
    },
    {
      key: "reconsidered_interpretation",
      label: "Reconsidered interpretation",
      render: "prose",
    },
    {
      key: "motivational_conflict",
      label: "Motivational conflict",
      render: "prose",
    },
    {
      key: "revised_action_tendency",
      label: "Revised action tendency",
      render: "prose",
    },
  ],
  system: REAPPRAISAL_SYSTEM,
  buildPrompt: buildReappraisalPrompt,
};

const DECISION_SYSTEM = `You generate and explain a character’s final behavioral response for a behavioral-prediction benchmark.

You are given the character’s relevant context, initial appraisal, and reflective reappraisal. Determine what the character actually does or says and explain why this response is most plausible for this particular character.

Rules:
- Treat all supplied information as canonical.
- Select the single most plausible response for this character in the current situation.
- Ground the response in the character’s background, relationships, tendencies, current state, immediate memories, initial appraisal, and reflective reappraisal.
- Give the reflective reappraisal greater weight when it explicitly changes the initial action tendency.
- Preserve unresolved tension when appropriate. The response may involve hesitation, qualification, delay, compromise, or imperfect behavior.
- Do not assume the character acts optimally, morally, rationally, or consistently.
- Do not invent new events, information, memories, options, resources, or reactions from other people.
- Stay within the opportunities and constraints established by the situation.
- Do not list alternative actions.
- Do not continue the scene beyond the character’s immediate response.
- Refer to the character in the third person.
- Return exactly one JSON object with no additional prose.

Field definitions:

action:
Describe only the character’s immediate, externally observable behavior. Include what the character says when relevant. Do not include thoughts, feelings, motives, analysis, or explanation.

explanation:
Explain the causal path from the initial appraisal to the final action.

For a REFLECTIVE decision:
- state the initial action tendency;
- state what reflection introduced;
- explain whether the initial tendency was retained, strengthened, softened, or reversed;
- explain why the resulting tendency produced the final action;
- acknowledge the most important competing influence when one remains.

For an IMMEDIATE decision:
- explain how the initial interpretation, current state, tendencies, relationships, and immediate memories produced the action;
- do not introduce reflective memories or deliberative reconsideration.

Do not invent information or provide a generic post-hoc justification.`;

function buildDecisionPrompt(input: StepInput): string {
  return `Consolidated initial context:

"""
${priorField(input, STEP_CONSOLIDATE, "initial_context")}
"""

Initial appraisal:

"""
${priorStepBlock(input, appraisalStep)}
"""

Reflective reappraisal:

"""
${priorStepBlock(input, reappraisalStep)}
"""

Generate the single most plausible immediate action the character takes and explain why.

The action must contain only externally observable behavior. The explanation must connect that behavior to the supplied character evidence and appraisal process.

Return JSON only:

{
  "action": "",
  "explanation": ""
}`;
}

/**
 * Part 5 — the flow's actual output.
 *
 * Everything before this produces evidence; this is the only part that commits
 * to what the person does. `action` is therefore the flow's answer, and what a
 * later evaluation stage scores — see `fullFlow.outcome`.
 */
const decisionStep: FlowStep = {
  key: STEP_DECISION,
  label: "Final decision",
  description:
    "Commits to the single most plausible thing the person does or says, and traces the causal path that produced it — the initial tendency, what reflection introduced, whether that retained, strengthened, softened, or reversed the impulse, and which competing influence still remains. Hesitation, delay, and compromise are allowed; alternatives are not listed and the scene does not continue past the response.",
  requiresContext: [],
  fields: [
    { key: "action", label: "Action", render: "prose" },
    { key: "explanation", label: "Explanation", render: "prose" },
  ],
  system: DECISION_SYSTEM,
  buildPrompt: buildDecisionPrompt,
};

export const fullFlow: Flow = {
  key: "full_flow",
  label: "Full Flow",
  description:
    "The full character decision model: extract, consolidate, appraise fast, then reappraise deliberately with reflective memories before deciding.",
  steps: [
    attributesStep,
    consolidateStep,
    appraisalStep,
    reappraisalStep,
    decisionStep,
  ],
  // What this flow is ultimately claiming. Named rather than inferred, so the
  // page can lead with the prediction instead of burying it under the nineteen
  // intermediate fields, and so a later evaluation stage knows what to score.
  outcome: {
    stepKey: STEP_DECISION,
    fieldKey: "action",
    reasonKey: "explanation",
  },
};
