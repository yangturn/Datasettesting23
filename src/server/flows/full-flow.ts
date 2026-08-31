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

Reconsider the situation from the character’s subjective perspective. Show how reflective memories, broader experience, values, roles, relationships, and anticipated consequences modify or reinforce the initial appraisal.

Rules:
- Treat all supplied information as canonical.
- Reason from the character’s subjective perspective.
- Ground every conclusion in the supplied context, initial appraisal, or reflective memories.
- Do not invent biography, events, relationships, memories, values, capabilities, or constraints.
- Preserve the initial appraisal as the character’s genuine first reaction.
- Do not assume that reflection necessarily changes the initial reaction.
- Identify what becomes newly salient through reflection.
- Reconsider initial assumptions when reflective evidence supports doing so.
- Infer active goals only during this appraisal; do not introduce unsupported goals.
- Consider plausible near-term and personally meaningful consequences.
- Compare competing concerns without turning the output into an exhaustive option analysis.
- Preserve uncertainty or conflict when the supplied evidence does not clearly resolve it.
- Do not describe the final action as already performed.
- The revised action tendency remains a provisional inclination, not the final behavioral output.
- Refer to the character in the third person.
- State the appraisal directly rather than using hedging such as “perhaps,” “possibly,” or “might.”
- Avoid repeating the initial context unless explaining how its meaning has changed.
- Treat the initial appraisal as a genuine part of the character’s decision process, not something to replace.
- Explicitly state whether reflection retains, strengthens, softens, or reverses the initial tendency.
- If the tendency changes, identify exactly which reflective evidence caused the change.
- If the tendency does not change, explain how reflection reinforces it.
- Do not replace character-specific intuition with generic rationality, morality, politeness, or optimization.
- Reflection should change the appraisal only when the newly available evidence is strong enough to do so.
- Return exactly one JSON object with no additional prose.

Field definitions:

initial_tendency:
Restate the character’s initial provisional impulse without changing its meaning.

reflective_update:
Identify the specific reflective memories or broader considerations that reinforce, weaken, qualify, or reverse the initial appraisal.

change_from_initial:
Return exactly one value:
- RETAINED
- STRENGTHENED
- SOFTENED
- REVERSED

reconsidered_interpretation:
Describe how the character now understands the situation after reflection. State whether the initial interpretation is reinforced, qualified, or revised.

motivational_conflict:
Describe the principal tension among the character’s active concerns, goals, values, relationships, or preferences. Do not artificially create conflict if the evidence points consistently in one direction.

revised_action_tendency:
State the character’s inclination after reflection.`;

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

Generate the character’s reflective reappraisal.

Explain how deliberate consideration and reflective memories reinforce, qualify, or change the initial appraisal. Do not invent information or perform the final action.

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
    "Reconsiders the moment with reflective memories in hand: restates the first impulse, names the reflective evidence bearing on it, and commits to whether reflection retained, strengthened, softened, or reversed it. The first reaction is treated as a genuine part of the decision rather than something to replace, and the revised inclination stays provisional.",
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
  outcome: { stepKey: STEP_DECISION, fieldKey: "action" },
};
