import "server-only";

import { REFLECTIVE_STEPS, STEP_REAPPRAISAL } from "@/server/flows/full-flow";
import { IMMEDIATE_STEPS } from "@/server/flows/immediate-flow";
import {
  immediateDecisionStep,
  reflectiveDecisionStep,
} from "@/server/flows/revised-decision";
import {
  contextBlock,
  priorField,
  priorStepBlock,
  STEP_APPRAISAL,
  STEP_CONSOLIDATE,
  STEP_DECISION,
} from "@/server/flows/shared";
import {
  substituteSteps,
  type Flow,
  type FlowStep,
  type StepInput,
} from "@/server/flows/types";

/**
 * Full Flow v2 — the revised appraisal and reappraisal, in third person.
 *
 * This exists to make Full Flow, First Person a real ablation. That flow rewrote
 * parts 3 and 4 substantially: it engages the personality field, defines what
 * each `change_from_initial` value means, copies the initial tendency verbatim
 * instead of paraphrasing it, caps field length, and bans several kinds of
 * reasoning the original permitted. All of that arrived together with the change
 * of voice, so comparing it against the original Full Flow would measure the
 * whole package and report it as a perspective effect.
 *
 * v2 carries every one of those revisions and none of the first-person voice.
 * The only intended difference between this flow and Full Flow, First Person is
 * therefore perspective:
 *
 *   full_flow              original prompts, third person
 *   full_flow_v2           revised prompts, third person
 *   full_flow_first_person revised prompts, first person
 *
 * Parts 1, 2 and 5 are the same step objects in all three, so the divergence is
 * confined to parts 3 and 4.
 *
 * These two prompts are a conversion of the first-person text rather than
 * independently written, which is the point — a separately authored third-person
 * prompt would reintroduce exactly the confound this flow exists to remove. Most
 * rules are identical; the ones that could not survive the change of voice are
 * listed in `docs` alongside what replaced them.
 */

// ---------------------------------------------------------------------------
// Part 3 — revised initial appraisal, third person
// ---------------------------------------------------------------------------

const V2_APPRAISAL_SYSTEM = `You generate a character’s initial psychological appraisal of a situation for a behavioral-prediction benchmark.

You are given a consolidated account containing the relevant character background, objective situation, and the character’s pre-appraisal state and immediately accessible memories.

Generate the character’s immediate subjective appraisal before deliberate reflection. Describe the character’s own inner experience from their subjective standpoint.

This appraisal represents fast and intuitive processing. It may be incomplete, ambivalent, or biased by the character’s personality and response style, background, relationships, tendencies, current state, and immediately accessible memories.

Rules:

* Treat the supplied initial context as canonical.
* Use only information contained in the supplied initial context.
* Remain within the character’s knowledge and subjective perspective.
* Write every field in the third person, referring to the character by name or with appropriate third-person pronouns.
* Refer to other people by name or with appropriate third-person pronouns.
* Write as a rendering of the character’s inner experience, not as an outside observer’s commentary about the character.
* Do not use analyst or model-planning language such as “the character should,” “I need to portray,” “the context suggests,” or “a plausible response is.”
* Ground every interpretation, emotion, concern, assumption, and impulse in the supplied context.
* Allow the supplied personality and response style to shape what the character notices, how strongly they react, what feels personally significant, and which impulse arises.
* Do not mechanically restate personality descriptions, values, memories, tendencies, or other context. Express their immediate psychological effect.
* Keep subjective interpretations distinct from objective facts.
* Do not present assumptions about another person’s internal state as verified knowledge.
* Express automatic assumptions about others as the character’s own reading of observable behavior, using formulations such as “the character takes this as…,” “it feels to the character as though…,” or “the character reads their response as…”
* Do not invent biography, relationships, events, memories, values, motivations, personality traits, capabilities, constraints, or observable details.
* Do not introduce, reconstruct, or indirectly recover reflective memories.
* Do not conduct extended deliberation or systematically compare possible responses.
* Do not weigh advantages and disadvantages.
* Do not calculate distant or detailed consequences.
* Do not resolve competing concerns or force the appraisal into a single coherent position.
* Do not make a final decision or describe an action as already performed.
* The initial action tendency must remain a provisional impulse, not a commitment or final choice.
* Preserve ambivalence when multiple influences are immediately active.
* State the character’s subjective experience directly. Avoid detached speculation such as “perhaps,” “possibly,” “might,” or “would.”
* Do not provide step-by-step reasoning, explain how the appraisal was derived, or cite the supplied context as evidence.
* Keep each field concise, normally one to three sentences.
* Avoid repeating the same content across fields.
* Return exactly one JSON object with no additional prose.

Field definitions:

initial_interpretation:
Express what the event immediately appears to mean to the character. Capture the character’s first subjective understanding of what is happening or what the event signifies, without treating that understanding as objectively correct. Focus on the perceived meaning of the event, not the character’s emotions, concerns, or intended response.

initial_emotional_reaction:
Express the character’s immediate emotional response in the third person. Describe emotions produced, intensified, reduced, or changed by the event, accounting for the emotional, physical, and cognitive state the character was already carrying. Do not turn the emotional reaction into an interpretation or behavioral decision.

activated_concerns:
Express what immediately feels important, threatened, desired, or at stake to the character. Include activated values, needs, preferences, roles, commitments, relationships, self-conceptions, or vulnerabilities. Preserve competing concerns without ranking them or determining which should prevail.

automatic_theory_of_mind:
Express the character’s immediate, automatic reading of what other relevant people want, expect, feel, believe, or intend. Frame these as the character’s subjective impressions based on available cues, not as verified access to another person’s mind. Do not deliberate over multiple possible explanations.

initial_action_tendency:
Express the character’s first behavioral impulse in the third person, such as approaching, avoiding, accepting, refusing, delaying, questioning, reassuring, defending, appeasing, confronting, or withdrawing. Connect the impulse to the immediate appraisal without comparing alternatives, committing to it, or treating it as a final decision.`;

function buildV2AppraisalPrompt(input: StepInput): string {
  return `Consolidated initial context:

"""
${priorField(input, STEP_CONSOLIDATE, "initial_context")}
"""

Generate the character’s immediate appraisal of the situation before deliberate reflection.

Write each field as a rendering of the character’s own inner experience in the third person, referring to the character by name or with appropriate third-person pronouns. Do not comment on the character as an outside observer or use model-planning language.

Use only the supplied initial context. Do not introduce reflective memories, conduct extended reasoning, systematically compare responses, resolve competing concerns, or make the final decision.

Return JSON only:

{
"initial_interpretation": "",
"initial_emotional_reaction": "",
"activated_concerns": "",
"automatic_theory_of_mind": "",
"initial_action_tendency": ""
}`;
}

const v2AppraisalStep: FlowStep = {
  key: STEP_APPRAISAL,
  label: "Initial appraisal",
  description:
    "Reads only part 2's account and produces the person's fast, intuitive first read of the moment — what it seems to mean, what it stirs up, what suddenly feels at stake, how they read the other people, and the first impulse. The revised version of this part: it engages the extracted personality, bans weighing pros and cons, and caps each field at a few sentences. Competing concerns are left unresolved and the impulse stays provisional.",
  requiresContext: [],
  fields: [
    {
      key: "initial_interpretation",
      label: "Initial interpretation",
      render: "prose",
    },
    {
      key: "initial_emotional_reaction",
      label: "Initial emotional reaction",
      render: "prose",
    },
    { key: "activated_concerns", label: "Activated concerns", render: "prose" },
    {
      key: "automatic_theory_of_mind",
      label: "Automatic theory of mind",
      render: "prose",
    },
    {
      key: "initial_action_tendency",
      label: "Initial action tendency",
      render: "prose",
    },
  ],
  system: V2_APPRAISAL_SYSTEM,
  buildPrompt: buildV2AppraisalPrompt,
};

// ---------------------------------------------------------------------------
// Part 4 — revised reflective reappraisal, third person
// ---------------------------------------------------------------------------

const V2_REAPPRAISAL_SYSTEM = `You generate a character’s deliberate reappraisal of a situation for a behavioral-prediction benchmark.

You are given:

1. The consolidated context available during the initial appraisal.
2. The character’s initial appraisal and provisional action tendency.
3. Reflective memories that become accessible through deliberate thought.

Reconsider the situation from the character’s subjective perspective using all information now available. Integrate the objective situation, relationships, behavioral tendencies, personality and response style, current state, immediate memories, initial appraisal, and reflective memories.

Reflective memories provide new evidence, but they are not the sole basis of deliberation. The reappraisal should represent the character’s broader consideration of the situation rather than a summary of the newly introduced memories.

Unlike the initial appraisal, this stage permits deliberate comparison and consideration of consequences. It remains character-limited, emotionally influenced, and provisional rather than representing an objectively optimal decision.

Rules:

* Treat all supplied information as canonical.
* Use only the supplied consolidated context, initial appraisal, and reflective memories.
* Ground every interpretation, consideration, conflict, and revised impulse in the supplied information.
* Write every prose field in the third person, referring to the character by name or with appropriate third-person pronouns.
* Refer to other people by name or with appropriate third-person pronouns.
* Write as a rendering of the character’s inner reflection, not as spoken dialogue or an outside observer’s commentary about the character.
* Do not use analyst or model-planning language such as “the character should,” “I need to portray,” “the context indicates,” or “the optimal response is.”
* Remain within the character’s knowledge and subjective perspective.
* Do not present assumptions about another person’s thoughts, feelings, or intentions as verified knowledge.
* Do not invent biography, events, relationships, memories, values, goals, motivations, personality traits, capabilities, constraints, or observable details.
* Preserve the initial appraisal as the character’s genuine first reaction, even when later reflection changes it.
* Copy the supplied \`initial_action_tendency\` verbatim into \`initial_tendency\`. Do not summarize, reinterpret, strengthen, soften, or otherwise alter it.
* Consider the main plausible responses and their personally meaningful consequences.
* Keep the comparison focused on responses that are genuinely available and relevant to this character. Do not generate an exhaustive option list.
* Consider practical constraints, timing, uncertainty, reversibility, relationship consequences, and effects on relevant values or commitments when supported by the context.
* Determine which considerations carry the most weight for this particular character rather than applying generic standards of good decision-making.
* Allow the character’s personality, emotional sensitivities, coping style, habits, relationships, fatigue, and biases to continue shaping the deliberation.
* Do not assume that reflection makes the character more rational, moral, polite, cautious, self-controlled, or socially desirable.
* Do not assume that reflective memories are more important than immediate memories, current state, established tendencies, or the initial appraisal.
* Do not assume that reflection changes the initial tendency.
* Explicitly classify the change as \`RETAINED\`, \`STRENGTHENED\`, \`SOFTENED\`, or \`REVERSED\`.
* Keep \`change_from_initial\` consistent with \`initial_tendency\` and \`revised_action_tendency\`:

  * \`RETAINED\`: the revised tendency remains in the same direction with no meaningful change in strength.
  * \`STRENGTHENED\`: the revised tendency remains in the same direction and becomes firmer or more compelling.
  * \`SOFTENED\`: the revised tendency remains in the same general direction but becomes weaker, more conditional, or more hesitant.
  * \`REVERSED\`: the revised tendency changes to an opposing or materially different response.
* If the tendency changes, identify the supplied considerations that caused the change.
* If the tendency remains, identify what reinforces it despite reflection.
* Preserve uncertainty, ambivalence, or unresolved conflict when the available information does not clearly resolve it.
* Do not manufacture motivational conflict when the relevant considerations point consistently in one direction.
* Do not perform the final action or describe it as already performed.
* The revised action tendency must remain a provisional inclination rather than a completed action or final commitment.
* Avoid unnecessarily repeating the consolidated context, initial appraisal, or memories.
* Return exactly one JSON object with no additional prose.

Field definitions:

initial_tendency:
Copy the character’s \`initial_action_tendency\` from the initial appraisal verbatim. Preserve its exact wording and meaning.

reflective_update:
Express the character’s deliberate reconsideration in the third person using the complete available context. Briefly compare the main plausible responses and their personally meaningful consequences. Explain how relevant constraints, relationships, values, tendencies, current state, immediate memories, and reflective memories reinforce or modify the initial tendency. Do not merely summarize the reflective memories.

change_from_initial:
Return exactly one value:

* \`RETAINED\`
* \`STRENGTHENED\`
* \`SOFTENED\`
* \`REVERSED\`

reconsidered_interpretation:
Express how the character now understands the situation after deliberation. State in the third person how the initial interpretation has been reinforced, qualified, or revised. Focus on the perceived meaning of the situation rather than repeating the response comparison.

motivational_conflict:
Express in the third person the principal unresolved tension among the character’s relationships, tendencies, personality, current state, concerns, commitments, and anticipated consequences. Do not manufacture conflict when the evidence points consistently in one direction. If no material conflict remains, state that directly.

revised_action_tendency:
Express the character’s post-deliberation inclination in the third person. Connect it to the considerations that carried the most weight while keeping it provisional. Do not perform the action, present it as a final commitment, or repeat the full deliberation.`;

function buildV2ReappraisalPrompt(input: StepInput): string {
  return `Consolidated initial context:

"""
${priorField(input, STEP_CONSOLIDATE, "initial_context")}
"""

Initial appraisal:

"""
${priorStepBlock(input, v2AppraisalStep)}
"""

Reflective memories:

"""
${contextBlock(input, "reflective_memories")}
"""

Generate the character’s deliberate reappraisal.

Use the complete available context, not only the reflective memories. Preserve the initial appraisal as the character’s genuine first reaction and copy \`initial_action_tendency\` verbatim into \`initial_tendency\`.

Write all prose fields as a rendering of the character’s own reflection in the third person. Do not comment on the character as an outside observer or use model-planning language.

Explain whether deliberation retains, strengthens, softens, or reverses the initial tendency. Keep the classification consistent with the revised action tendency.

Do not invent information, perform the final action, or present the revised tendency as a final commitment.

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

const v2ReappraisalStep: FlowStep = {
  key: STEP_REAPPRAISAL,
  label: "Reflective reappraisal",
  description:
    "Reconsiders the moment with reflective memories in hand: it carries the first impulse over verbatim, weighs the responses actually open to the person, and commits to whether reflection retained, strengthened, softened, or reversed that impulse — with each of those four verdicts given an explicit definition. Deliberation is not assumed to make them more rational or agreeable, and the revised inclination stays provisional.",
  requiresContext: ["reflective_memories"],
  fields: [
    { key: "initial_tendency", label: "Initial tendency", render: "prose" },
    { key: "reflective_update", label: "Reflective update", render: "prose" },
    {
      key: "change_from_initial",
      label: "Change from initial",
      render: "value",
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
  system: V2_REAPPRAISAL_SYSTEM,
  buildPrompt: buildV2ReappraisalPrompt,
};

// ---------------------------------------------------------------------------
// Part 5, and the immediate branch's part 4 — the shared decision, third person
// ---------------------------------------------------------------------------

/**
 * Both decision parts come from `revised-decision.ts` rather than being written
 * here.
 *
 * They were already byte-identical to Full Flow, First Person's apart from the
 * phrase naming the voice of the appraisal they read — and since this arm exists
 * to be that flow's control, a decision prompt able to drift between the two
 * would be a confound in the very part that produces their scored output. So it
 * is one prompt with the voice as a parameter.
 *
 * `description` stays here because the page shows it and the model never does:
 * the first-person arm's says where the voice changes, which would be wrong on
 * this one.
 */
const v2DecisionStep = reflectiveDecisionStep({
  voice: "third",
  description:
    "Turns the person's reflected-on inclination into the one thing an onlooker would actually see or hear, and traces the causal path that produced it. Part 4's verdict is treated as binding — copied, not re-derived — and the deliberation is not redone.",
  appraisalStep: v2AppraisalStep,
  reappraisalStep: v2ReappraisalStep,
});

const v2ImmediateDecisionStep = immediateDecisionStep({
  voice: "third",
  description:
    "Turns the person's first impulse straight into the one thing an onlooker would see or hear, with no time to reflect. Habits, current state, cued memories and the first impulse carry the weight; the response may be impulsive, habitual or imperfect.",
  appraisalStep: v2AppraisalStep,
});

// ---------------------------------------------------------------------------
// The pipelines
// ---------------------------------------------------------------------------

/** The revised parts of the reflective pipeline, keyed by the step they replace. */
const V2_REFLECTIVE_OVERRIDES = new Map<string, FlowStep>([
  [STEP_APPRAISAL, v2AppraisalStep],
  [STEP_REAPPRAISAL, v2ReappraisalStep],
  [STEP_DECISION, v2DecisionStep],
]);

/**
 * The immediate pipeline's, kept separate for the same reason the first-person
 * flow keeps its two apart: both branches key their final part `decision`, but
 * the reflective one reads a reappraisal the immediate one never produced.
 */
const V2_IMMEDIATE_OVERRIDES = new Map<string, FlowStep>([
  [STEP_APPRAISAL, v2AppraisalStep],
  [STEP_DECISION, v2ImmediateDecisionStep],
]);

const V2_REFLECTIVE_STEPS = substituteSteps(
  REFLECTIVE_STEPS,
  V2_REFLECTIVE_OVERRIDES,
);
const V2_IMMEDIATE_STEPS = substituteSteps(
  IMMEDIATE_STEPS,
  V2_IMMEDIATE_OVERRIDES,
);

export const fullFlowV2Flow: Flow = {
  key: "full_flow_v2",
  label: "Second Thought, 3rd person",
  description:
    "Full Flow with the revised appraisal and reappraisal: the extracted personality is put to work, each verdict on how reflection moved the first impulse is explicitly defined, and the initial tendency is carried forward verbatim rather than paraphrased. Third person throughout — the control arm for Second Thought, 1st person, which runs these same revisions in first person. On a time-sensitive scenario, where there are no reflective memories to draw on, the reappraisal is skipped: it runs Immediate Flow's four parts instead, carrying the revised appraisal and a decision built on the first impulse.",
  steps: V2_REFLECTIVE_STEPS,
  /**
   * The same time-sensitive fallback as Full Flow, taking the revised parts with
   * it — mirroring Full Flow, First Person exactly, so the two arms differ only
   * in voice on every situation type rather than only on the reflective ones.
   */
  stepsFor: (scenario) =>
    scenario.situation_type === "TIME_SENSITIVE"
      ? V2_IMMEDIATE_STEPS
      : V2_REFLECTIVE_STEPS,
  outcome: {
    stepKey: STEP_DECISION,
    fieldKey: "action",
    reasonKey: "explanation",
  },
};
