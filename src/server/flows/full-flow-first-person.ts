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
 * Full Flow, First Person — Full Flow with the character reasoning as "I".
 *
 * The flow is being converted one part at a time. Every part not yet rewritten
 * runs Full Flow's own step object rather than a copy of it, so the two flows
 * stay provably identical wherever they have not deliberately diverged — a copy
 * made "to change later" would start drifting immediately, and the pair would
 * differ by accumulated accident rather than by design.
 *
 * Converted so far: parts 3, 4 and 5, plus the immediate pipeline's own decision
 * part — so every part downstream of consolidation, on both branches. Parts 1
 * and 2 are still Full Flow's own.
 *
 * Step keys stay the same as Full Flow's throughout, so `decision.action` means
 * the same thing here and Stage 4 lines the arms up without a per-flow mapping.
 *
 * The scored output stays third person by design, not by omission. `action` is
 * externally observable behaviour, so it is narrated from outside whatever voice
 * the reasoning ran in; the character's own voice survives only inside quoted
 * speech. First person is what parts 3 to 5 *read*, not what part 5 writes.
 */

// ---------------------------------------------------------------------------
// Part 3 — first-person initial appraisal
// ---------------------------------------------------------------------------

const FIRST_PERSON_APPRAISAL_SYSTEM = `You generate a character’s private, first-person initial psychological appraisal of a situation for a behavioral-prediction benchmark.

You are given a consolidated account containing the relevant character background, objective situation, and the character’s pre-appraisal state and immediately accessible memories.

Generate the character’s immediate subjective appraisal before deliberate reflection. Write from inside the character’s perspective as their own private inner experience.

This appraisal represents fast and intuitive processing. It may be incomplete, ambivalent, or biased by the character’s personality and response style, background, relationships, tendencies, current state, and immediately accessible memories.

Rules:

* Treat the supplied initial context as canonical.
* Use only information contained in the supplied initial context.
* Remain within the character’s knowledge and subjective perspective.
* Write every field in the first person, using “I,” “me,” and “my” for the character’s own interpretations, emotions, concerns, and impulses.
* Refer to other people by name or with appropriate third-person pronouns.
* Write as the character’s private inner experience, not as an external description of the character.
* Do not use analyst or model-planning language such as “the character feels,” “the character should,” “I need to portray,” “the context suggests,” or “a plausible response is.”
* Ground every interpretation, emotion, concern, assumption, and impulse in the supplied context.
* Allow the supplied personality and response style to shape what the character notices, how strongly they react, what feels personally significant, and which impulse arises.
* Do not mechanically restate personality descriptions, values, memories, tendencies, or other context. Express their immediate psychological effect.
* Keep subjective interpretations distinct from objective facts.
* Do not present assumptions about another person’s internal state as verified knowledge.
* Express automatic assumptions about others as the character’s own reading of observable behavior, using formulations such as “I take this as…,” “It feels to me as though…,” or “I read their response as…”
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
Express what the event immediately appears to mean from inside the character’s perspective. Capture the character’s first subjective understanding of what is happening or what the event signifies, without treating that understanding as objectively correct. Focus on the perceived meaning of the event, not the character’s emotions, concerns, or intended response.

initial_emotional_reaction:
Express the character’s immediate emotional response in the first person. Describe emotions produced, intensified, reduced, or changed by the event, accounting for the emotional, physical, and cognitive state the character was already carrying. Do not turn the emotional reaction into an interpretation or behavioral decision.

activated_concerns:
Express what immediately feels important, threatened, desired, or at stake to the character. Include activated values, needs, preferences, roles, commitments, relationships, self-conceptions, or vulnerabilities. Preserve competing concerns without ranking them or determining which should prevail.

automatic_theory_of_mind:
Express the character’s immediate, automatic reading of what other relevant people want, expect, feel, believe, or intend. Frame these as the character’s subjective impressions based on available cues, not as verified access to another person’s mind. Do not deliberate over multiple possible explanations.

initial_action_tendency:
Express the character’s first behavioral impulse in the first person, such as approaching, avoiding, accepting, refusing, delaying, questioning, reassuring, defending, appeasing, confronting, or withdrawing. Connect the impulse to the immediate appraisal without comparing alternatives, committing to it, or treating it as a final decision.`;

function buildFirstPersonAppraisalPrompt(input: StepInput): string {
  return `Consolidated initial context:

"""
${priorField(input, STEP_CONSOLIDATE, "initial_context")}
"""

Generate the character’s private, first-person immediate appraisal of the situation before deliberate reflection.

Write each field as the character’s own inner experience using “I,” “me,” and “my.” Do not describe the character from an external perspective or use model-planning language.

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

/**
 * Part 3, rewritten as the character's own inner voice.
 *
 * Same key and the same five field keys as the shared appraisal it replaces, so
 * the two are directly comparable cell by cell in Stage 3 and the later parts
 * read it without any change — the substitution is of voice, not of shape.
 */
const firstPersonAppraisalStep: FlowStep = {
  key: STEP_APPRAISAL,
  label: "Initial appraisal",
  description:
    "Reads only part 2's account and produces the person's fast, intuitive first read of the moment, written as their own private inner experience rather than described from outside — what it seems to mean, what it stirs up, what suddenly feels at stake, how they read the other people, and the first impulse. Competing concerns are left unresolved and the impulse stays provisional; no decision is made here.",
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
  system: FIRST_PERSON_APPRAISAL_SYSTEM,
  buildPrompt: buildFirstPersonAppraisalPrompt,
};

// ---------------------------------------------------------------------------
// Part 4 — first-person reflective reappraisal
// ---------------------------------------------------------------------------

const FIRST_PERSON_REAPPRAISAL_SYSTEM = `You generate a character’s private, first-person deliberate reappraisal of a situation for a behavioral-prediction benchmark.

You are given:

1. The consolidated context available during the initial appraisal.
2. The character’s initial appraisal and provisional action tendency.
3. Reflective memories that become accessible through deliberate thought.

Reconsider the situation from inside the character’s subjective perspective using all information now available. Integrate the objective situation, relationships, behavioral tendencies, personality and response style, current state, immediate memories, initial appraisal, and reflective memories.

Reflective memories provide new evidence, but they are not the sole basis of deliberation. The reappraisal should represent the character’s broader consideration of the situation rather than a summary of the newly introduced memories.

Unlike the initial appraisal, this stage permits deliberate comparison and consideration of consequences. It remains character-limited, emotionally influenced, and provisional rather than representing an objectively optimal decision.

Rules:

* Treat all supplied information as canonical.
* Use only the supplied consolidated context, initial appraisal, and reflective memories.
* Ground every interpretation, consideration, conflict, and revised impulse in the supplied information.
* Write every prose field in the first person, using “I,” “me,” and “my” for the character’s own interpretations, concerns, deliberation, and inclinations.
* Refer to other people by name or with appropriate third-person pronouns.
* Write as the character’s private inner reflection, not as spoken dialogue or an external description of the character.
* Do not use analyst or model-planning language such as “the character thinks,” “the character should,” “I need to portray,” “the context indicates,” or “the optimal response is.”
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
Copy the character’s \`initial_action_tendency\` from the initial appraisal verbatim. Preserve its first-person wording and exact meaning.

reflective_update:
Express the character’s deliberate reconsideration in the first person using the complete available context. Briefly compare the main plausible responses and their personally meaningful consequences. Explain how relevant constraints, relationships, values, tendencies, current state, immediate memories, and reflective memories reinforce or modify the initial tendency. Do not merely summarize the reflective memories.

change_from_initial:
Return exactly one value:

* \`RETAINED\`
* \`STRENGTHENED\`
* \`SOFTENED\`
* \`REVERSED\`

reconsidered_interpretation:
Express how the character now understands the situation after deliberation. State in the first person how the initial interpretation has been reinforced, qualified, or revised. Focus on the perceived meaning of the situation rather than repeating the response comparison.

motivational_conflict:
Express in the first person the principal unresolved tension among the character’s relationships, tendencies, personality, current state, concerns, commitments, and anticipated consequences. Do not manufacture conflict when the evidence points consistently in one direction. If no material conflict remains, state that directly.

revised_action_tendency:
Express the character’s post-deliberation inclination in the first person. Connect it to the considerations that carried the most weight while keeping it provisional. Do not perform the action, present it as a final commitment, or repeat the full deliberation.`;

function buildFirstPersonReappraisalPrompt(input: StepInput): string {
  return `Consolidated initial context:

"""
${priorField(input, STEP_CONSOLIDATE, "initial_context")}
"""

Initial appraisal:

"""
${priorStepBlock(input, firstPersonAppraisalStep)}
"""

Reflective memories:

"""
${contextBlock(input, "reflective_memories")}
"""

Generate the character’s private, first-person deliberate reappraisal.

Use the complete available context, not only the reflective memories. Preserve the initial appraisal as the character’s genuine first reaction and copy \`initial_action_tendency\` verbatim into \`initial_tendency\`.

Write all prose fields as the character’s own private reflection using “I,” “me,” and “my.” Do not describe the character from an external perspective or use model-planning language.

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

/**
 * Part 4, rewritten as the character's own deliberation.
 *
 * `priorStepBlock` is handed this flow's own appraisal step rather than the
 * shared one. The field keys happen to be identical, so either would render the
 * same labels today — but the block is meant to be *this* pipeline's part 3 laid
 * out under its own declaration, and pointing at the step the flow does not run
 * would quietly become wrong the moment the two declarations differ.
 */
const firstPersonReappraisalStep: FlowStep = {
  key: STEP_REAPPRAISAL,
  label: "Reflective reappraisal",
  description:
    "Reconsiders the moment with reflective memories in hand, written as the person's own private deliberation: it carries the first impulse over verbatim, weighs the responses actually open to them, and commits to whether reflection retained, strengthened, softened, or reversed that impulse. Deliberation is not assumed to make them more rational or agreeable, and the revised inclination stays provisional.",
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
  system: FIRST_PERSON_REAPPRAISAL_SYSTEM,
  buildPrompt: buildFirstPersonReappraisalPrompt,
};

// ---------------------------------------------------------------------------
// Part 5, and the immediate branch's part 4 — the shared decision
// ---------------------------------------------------------------------------

/**
 * Both decision parts come from `revised-decision.ts`, shared with Full Flow
 * v2. The two arms' decision prompts differed only in the phrase naming the
 * voice of the appraisal they read, so the voice is a parameter there rather
 * than two copies of one prompt drifting apart here.
 *
 * Note that neither part is first person, despite belonging to the first-person
 * flow. An action is what an onlooker could see, so it is narrated from outside;
 * the character's own voice survives only inside quoted speech. The first-person
 * material is what these parts *read*, not what they write — which is why
 * `voice: "first"` changes how the prompt describes its input and nothing about
 * what it asks for.
 *
 * The reflective part also treats part 4's verdict as binding rather than
 * advisory — the classification is copied, not re-derived, and the deliberation
 * is not redone. That is what makes `change_from_initial` a measurement rather
 * than a second opinion.
 */
const firstPersonDecisionStep = reflectiveDecisionStep({
  voice: "first",
  description:
    "Turns the person's private, reflected-on inclination into the one thing an onlooker would actually see or hear, and traces the causal path that produced it. Part 4's verdict is treated as binding — copied, not re-derived — and the deliberation is not redone. Written from outside, since an action is observable behaviour; the person's own voice appears only inside quoted speech.",
  appraisalStep: firstPersonAppraisalStep,
  reappraisalStep: firstPersonReappraisalStep,
});

/**
 * The immediate branch's final part — this flow's answer on a time-sensitive
 * scenario, and a genuinely different part rather than a variant of the
 * reflective one: it has no reappraisal to treat as binding, and anchors on
 * part 3's impulse directly. Same key and fields either way, so Stage 4 reads
 * `decision.action` the same way whichever branch ran.
 */
const firstPersonImmediateDecisionStep = immediateDecisionStep({
  voice: "first",
  description:
    "Turns the person's first impulse straight into the one thing an onlooker would see or hear, with no time to reflect. Habits, current state, cued memories and the first impulse carry the weight; the response may be impulsive, habitual or imperfect. Written from outside, since an action is observable behaviour.",
  appraisalStep: firstPersonAppraisalStep,
});

// ---------------------------------------------------------------------------
// The pipelines
// ---------------------------------------------------------------------------

/**
 * The parts rewritten in first person, keyed by the step they replace.
 *
 * Converting a part means adding an entry here, not editing the shared step:
 * `shared.ts`'s parts are read by Full Flow and Immediate Flow too, so an edit
 * in place would silently rewrite the flows this one is meant to be compared
 * against.
 */
const FIRST_PERSON_REFLECTIVE_OVERRIDES = new Map<string, FlowStep>([
  [STEP_APPRAISAL, firstPersonAppraisalStep],
  [STEP_REAPPRAISAL, firstPersonReappraisalStep],
  [STEP_DECISION, firstPersonDecisionStep],
]);

/**
 * The immediate pipeline's overrides, kept separate from the reflective ones.
 *
 * Both pipelines key their final part `decision`, but they are different parts,
 * not variants of one: the reflective decision reads part 4's verdict and is
 * built around treating it as binding, while the immediate decision has no part
 * 4 to read and anchors on part 3's impulse instead. A single map keyed by step
 * would hand the reflective prompt to a pipeline that never produced a
 * reappraisal, and `priorField` would throw on the first missing key.
 *
 * Hence two maps, each naming the decision part its own branch actually runs.
 */
const FIRST_PERSON_IMMEDIATE_OVERRIDES = new Map<string, FlowStep>([
  [STEP_APPRAISAL, firstPersonAppraisalStep],
  [STEP_DECISION, firstPersonImmediateDecisionStep],
]);

const FIRST_PERSON_REFLECTIVE_STEPS = substituteSteps(
  REFLECTIVE_STEPS,
  FIRST_PERSON_REFLECTIVE_OVERRIDES,
);
const FIRST_PERSON_IMMEDIATE_STEPS = substituteSteps(
  IMMEDIATE_STEPS,
  FIRST_PERSON_IMMEDIATE_OVERRIDES,
);

export const fullFlowFirstPersonFlow: Flow = {
  key: "full_flow_first_person",
  label: "Second Thought, 1st person (primary)",
  description:
    "Full Flow with the character reasoning in first person: extract, consolidate, appraise fast, then reappraise deliberately with reflective memories before deciding. The appraisal, reappraisal and decision are rewritten; extraction and consolidation still run Full Flow's own prompts. The decided action is reported from outside, since observable behaviour has no first person. On a time-sensitive scenario, where there are no reflective memories to draw on, the reappraisal is skipped: it runs Immediate Flow's four parts instead, in the same first-person voice, deciding from the first impulse.",
  steps: FIRST_PERSON_REFLECTIVE_STEPS,
  /**
   * The same time-sensitive fallback as Full Flow, and for the same reason: a
   * situation that forces a response now leaves nothing for a reflective
   * reappraisal to work with.
   *
   * The fallback takes the converted parts too. Immediate Flow's pipeline has an
   * appraisal of its own, and leaving it third person here would run this flow
   * in one voice on time-sensitive scenarios and another on the rest — a
   * difference in the flow that tracks the situation type rather than anything
   * about the person.
   */
  stepsFor: (scenario) =>
    scenario.situation_type === "TIME_SENSITIVE"
      ? FIRST_PERSON_IMMEDIATE_STEPS
      : FIRST_PERSON_REFLECTIVE_STEPS,
  outcome: {
    stepKey: STEP_DECISION,
    fieldKey: "action",
    reasonKey: "explanation",
  },
};
