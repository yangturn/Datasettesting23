import "server-only";

import {
  priorField,
  priorStepBlock,
  STEP_CONSOLIDATE,
  STEP_DECISION,
} from "@/server/flows/shared";
import type { FlowStep, StepInput } from "@/server/flows/types";

/**
 * Part 5 — the decision, shared by the two revised arms.
 *
 * Full Flow v2 and Full Flow, First Person are a matched pair: they exist to
 * measure what changes when parts 3 and 4 are reasoned in the character's own
 * voice instead of about them. That only works if every *other* part is held
 * fixed, and the decision is the part where holding it fixed is easiest to get
 * wrong — it is the arms' scored output, and it was carried as two copies of one
 * prompt that differed by two descriptive phrases. An edit to either copy's rule
 * list would have reached one arm and not the other, and the pair would have
 * differed by accumulated accident rather than by design, exactly as
 * `substituteSteps` exists to prevent at the step level.
 *
 * So there is one prompt here, in both branches, and the voice is a parameter.
 *
 * What the parameter varies is only how the prompt *describes its input*. The
 * output is third person in both arms and always was: `action` is externally
 * observable behaviour, so it is narrated from outside whatever voice the
 * cognition ran in, and the character's own voice survives only inside quoted
 * speech. This part therefore *reads* first person in one arm and third in the
 * other, and writes third person in both.
 *
 * Both explanation fields are written to *cite*: every influence the
 * explanation names has to be a specific fact a reader could find in the
 * consolidated context, and an appraisal-generated emotion or concern may
 * appear only beside the fact that produced it. That follows from how Stage 4
 * reads the reason. The judge holds the Stage 1 and Stage 2 material and
 * nothing from the flow, so an influence that exists only in the appraisal is,
 * from where it sits, unsupported — and it is told to penalise exactly that.
 * The first Stage 4 run showed it doing so: on the same predicted action, a
 * reason built from the appraisal's own constructs scored 4 on coherence where
 * one built from the context's recorded behaviour scored 8.
 */

/** Which voice the appraisal and reappraisal this part is handed were written in. */
export type AppraisalVoice = "first" | "third";

/**
 * The phrase the prompt uses when naming its own input.
 *
 * Load-bearing in both directions rather than cosmetic. The decision part is a
 * voice conversion — internal cognition in, observable third-person behaviour
 * out — and naming the input's voice is what makes the conversion explicit;
 * dropping it where the input really is first person invites `I` to leak into
 * `action`, since the model otherwise matches the voice it was given. Saying
 * "first-person" over a third-person appraisal is simply false, which is why the
 * two arms cannot share a single literal string.
 */
const VOICE_QUALIFIER: Record<AppraisalVoice, string> = {
  first: "first-person ",
  third: "",
};

const DECISION_FIELDS = [
  { key: "action", label: "Action", render: "prose" },
  { key: "explanation", label: "Explanation", render: "prose" },
] as const;

// ---------------------------------------------------------------------------
// The reflective branch's decision — reads part 4's verdict
// ---------------------------------------------------------------------------

function reflectiveDecisionSystem(voice: AppraisalVoice): string {
  const qualifier = VOICE_QUALIFIER[voice];
  return `You generate and explain a character’s final behavioral response for a behavioral-prediction benchmark.

You are given the character’s relevant context, ${qualifier}initial appraisal, and ${qualifier}reflective reappraisal. Determine what the character actually does or says and explain why this response is most plausible for this particular character.

The initial appraisal and reflective reappraisal represent the character’s private subjective cognition. Convert the post-reflection inclination into a single externally observable response without exposing unspoken thoughts as behavior or dialogue.

Rules:

* Treat all supplied information as canonical.
* Select the single most plausible immediate response for this character in the current situation.
* Use only the consolidated initial context, initial appraisal, and reflective reappraisal.
* Ground the response in the character’s background, personality and response style, relationships, behavioral tendencies, current state, immediate memories, initial appraisal, and reflective reappraisal.
* Preserve the initial appraisal as the character’s genuine first reaction.
* Treat \`initial_tendency\` as an unchanged record of the initial provisional impulse.
* Treat \`change_from_initial\` as the authoritative classification of how reflection affected that impulse.
* Treat \`revised_action_tendency\` as the character’s most recent provisional inclination and the proximal basis for the final response.
* Do not independently redo the reflective deliberation, replace its conclusions, or reclassify \`change_from_initial\`.
* Keep the final action consistent with the supplied \`revised_action_tendency\`, including any hesitation, qualification, delay, or compromise it contains.
* If unresolved conflict affects how the revised tendency is expressed, that conflict must already be present in the supplied information and must be identified in the explanation.
* Preserve unresolved tension when appropriate. The final response may involve hesitation, qualification, delay, compromise, emotional leakage, or imperfect behavior.
* Do not assume the character acts optimally, morally, rationally, consistently, cautiously, or in a socially desirable manner.
* Do not invent new events, information, memories, motivations, options, resources, opportunities, constraints, or reactions from other people.
* Stay within the opportunities and constraints established by the objective situation.
* Do not list or describe alternative actions.
* Do not continue the scene beyond the character’s single immediate response.
* Do not describe subsequent reactions, replies, consequences, or events.
* Refer to the character by name or with appropriate third-person pronouns.
* Write both output fields in third person, except for words spoken by the character inside direct quotation marks.
* Do not use analyst or model-planning language such as “the model predicts,” “the context suggests,” “the prompt indicates,” or “the optimal action is.”
* Return exactly one JSON object with no additional prose.

Field definitions:

action:
Describe only the character’s single immediate, externally observable behavior.

Include what the character says when speech is part of the response. Speech may naturally use first-person language inside direct quotation marks.

Do not include:

* unspoken thoughts;
* emotions or motives stated as internal facts;
* psychological interpretation;
* causal explanation;
* alternative actions;
* responses from other people;
* events occurring after the immediate response.

explanation:
Provide a concise third-person causal explanation of the final action, grounded in cited evidence.

Evidence means a specific fact stated in the consolidated initial context (a biography detail, relationship fact, established tendency, current-state item, immediate memory, or stated feature of the objective situation, including the time it allows for a response) or a reflective memory as the reflective reappraisal reports it. Name each piece of evidence specifically, in the terms the context uses, so that a reader holding only the context can locate it. Where the context states a disposition, cite the concrete biography detail or past behavior that demonstrates it rather than the disposition label.

The explanation must:

* cite the two to four pieces of evidence that most directly produced the final action, each as a specific fact rather than a summary or a trait label;
* when it mentions an interpretation, emotion, concern, assumption, or inclination from the initial appraisal or reflective reappraisal, give it together with the cited evidence that produced it, never on its own;
* cite what the objective situation states about the time available to respond (a deadline, a person waiting, or the absence of any pressure) and state that it left room for the deliberate reflection the explanation describes;
* state in one sentence whether the initial tendency was \`RETAINED\`, \`STRENGTHENED\`, \`SOFTENED\`, or \`REVERSED\`, exactly matching the supplied \`change_from_initial\`, and how the resulting \`revised_action_tendency\` produced the final action;
* when the final action departs from an established tendency in the context, cite the evidence that explains the departure;
* acknowledge the most important competing influence when one remains, citing its evidence.

Keep the account of the appraisal process to that one sentence and spend the rest of the explanation on the evidence and how it produced the behavior. Normally three to five sentences. Do not provide a generic post-hoc justification that could apply to any character.

Do not invent information, contradict the supplied appraisal process, expose private thoughts as observable behavior, or imply that reflection necessarily improved the character’s judgment. Do not treat an interpretation, emotion, concern, or inclination generated in the appraisal or reappraisal as evidence in its own right.`;
}

function buildReflectiveDecisionPrompt(
  input: StepInput,
  voice: AppraisalVoice,
  appraisalStep: FlowStep,
  reappraisalStep: FlowStep,
): string {
  const qualifier = VOICE_QUALIFIER[voice];
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

Generate the single most plausible immediate action the character takes after reflective reappraisal and explain why.

The initial appraisal and reflective reappraisal are written in the character’s ${qualifier}internal voice. Produce the externally observable action and causal explanation in third person. First-person language may appear only inside dialogue spoken by the character.

Preserve the supplied \`change_from_initial\` classification and use \`revised_action_tendency\` as the character’s most recent provisional inclination. Do not redo the appraisal or reflective deliberation.

The action must contain only externally observable behavior. The explanation must cite the specific facts from the consolidated initial context, and the reflective memories as the reappraisal reports them, that produced that behavior, naming each in the terms the context uses, must cite the time the situation allowed for a response and that it left room to deliberate, and must state the progression from initial appraisal to reflective reappraisal in one sentence.

Do not invent information, list alternative actions, or continue the scene beyond the character’s immediate response.

Return JSON only:

{
"action": "",
"explanation": ""
}`;
}

/**
 * The reflective branch's part 5, in the caller's voice.
 *
 * `description` is the caller's because the page shows it and the model never
 * does — the first-person arm's says so explicitly, which would be wrong on the
 * third-person arm. The appraisal and reappraisal steps are the caller's too:
 * each arm's part 5 must read that arm's own parts 3 and 4.
 */
export function reflectiveDecisionStep(options: {
  voice: AppraisalVoice;
  description: string;
  appraisalStep: FlowStep;
  reappraisalStep: FlowStep;
}): FlowStep {
  const { voice, description, appraisalStep, reappraisalStep } = options;
  return {
    key: STEP_DECISION,
    label: "Final decision",
    description,
    requiresContext: [],
    fields: [...DECISION_FIELDS],
    system: reflectiveDecisionSystem(voice),
    buildPrompt: (input) =>
      buildReflectiveDecisionPrompt(
        input,
        voice,
        appraisalStep,
        reappraisalStep,
      ),
  };
}

// ---------------------------------------------------------------------------
// The immediate branch's decision — no part 4 to read
// ---------------------------------------------------------------------------

function immediateDecisionSystem(voice: AppraisalVoice): string {
  const qualifier = VOICE_QUALIFIER[voice];
  return `You generate and explain a character’s immediate behavioral response for a behavioral-prediction benchmark.
You are given the character’s consolidated initial context and ${qualifier}initial appraisal. The situation requires an immediate or near-immediate response, so the character acts without deliberate reflection or access to reflective memories.
Determine what the character actually does or says based on the character’s initial interpretation, emotional reaction, activated concerns, automatic assumptions, and initial action tendency.
The initial appraisal represents the character’s private subjective cognition. Convert that appraisal into a single externally observable response without exposing unspoken thoughts as behavior or dialogue.
Rules:

* Treat all supplied information as canonical.
* Select the single most plausible immediate response for this character.
* Use only the consolidated initial context and initial appraisal.
* Preserve the initial appraisal as the character’s genuine immediate reaction.
* Treat \`initial_action_tendency\` as the character’s most recent provisional impulse and the proximal basis for the final response.
* Do not independently redo, revise, expand, or replace the initial appraisal.
* Keep the final action consistent with \`initial_action_tendency\`, including any hesitation, qualification, avoidance, or compromise it contains.
* If an established constraint or immediately active competing concern affects how the initial tendency is expressed, it must already be present in the supplied information and must be identified in the explanation.
* Do not introduce, reconstruct, infer, or use reflective memories.
* Do not perform reflective reappraisal, extended deliberation, or systematic comparison of responses.
* Do not weigh advantages and disadvantages.
* Do not calculate distant or detailed consequences.
* Give substantial weight to established personality and response style, tendencies, habits, relationship expectations, current state, immediate memories, activated concerns, and the initial action tendency.
* Allow the final response to be impulsive, habitual, emotionally influenced, incomplete, inconsistent, or imperfect.
* Do not assume the character acts optimally, morally, rationally, cautiously, consistently, or in a socially desirable manner.
* The character may hesitate briefly, use a familiar social script, or make a rapid compromise when supported by the context and available response time.
* Treat \`automatic_theory_of_mind\` as the character’s subjective impression of other people, not as verified knowledge of their internal states.
* Do not invent new facts, events, relationships, memories, motivations, options, resources, opportunities, constraints, or reactions from other people.
* Stay within the opportunities and constraints established by the objective situation.
* Do not list or describe alternative actions.
* Do not continue the scene beyond the character’s single immediate response.
* Do not describe subsequent reactions, replies, consequences, or events.
* Refer to the character by name or with appropriate third-person pronouns.
* Write both output fields in third person, except for words spoken by the character inside direct quotation marks.
* Do not use analyst or model-planning language such as “the model predicts,” “the context suggests,” “the prompt indicates,” or “the optimal action is.”
* Return exactly one JSON object with no additional prose.

Field definitions:
action:
Describe only the character’s single immediate, externally observable behavior.
Include what the character says when speech is part of the response. Speech may naturally use first-person language inside direct quotation marks.
Do not include:

* unspoken thoughts;
* emotions or motives stated as internal facts;
* psychological interpretation;
* causal explanation;
* alternative actions;
* responses from other people;
* events occurring after the immediate response.

explanation:
Provide a concise third-person causal explanation of the immediate response, grounded in cited evidence.
Evidence means a specific fact stated in the consolidated initial context: a biography detail, relationship fact, established tendency, current-state item, immediate memory, or stated feature of the objective situation, including the time it allows for a response. Name each piece of evidence specifically, in the terms the context uses, so that a reader holding only the context can locate it. Where the context states a disposition, cite the concrete biography detail or past behavior that demonstrates it rather than the disposition label.
The explanation must:

* cite the two to four pieces of evidence that most directly produced the response, each as a specific fact rather than a summary or a trait label;
* when it mentions the event’s subjective meaning, the emotional reaction, an activated concern, an automatic assumption about another person, or the initial action tendency from the ${qualifier}initial appraisal, give it together with the cited evidence that produced it, never on its own;
* when the response departs from an established tendency in the context, cite the evidence that explains the departure;
* when the context contains an immediately present pull against the response (a cued memory, an active concern, a habit, or a current-state item), name it in one clause with its cited evidence and say what overrode it;
* cite what the objective situation states about the time available to respond (a person waiting, the seconds or minutes allowed, or a demand for an answer now) and state that it left no room for deliberate reflection, so the response follows the first impulse;
* state in one sentence how the cited evidence produced the initial action tendency and how that tendency produced the externally observable response.

When referencing \`automatic_theory_of_mind\`, preserve it as the character’s subjective assumption rather than presenting it as an objective fact.
Normally three to five sentences.
Do not:

* introduce reflective memories;
* conduct deliberative reconsideration;
* compare alternative responses;
* treat an interpretation, emotion, concern, or inclination generated in the appraisal as evidence in its own right;
* repeat every appraisal field mechanically;
* invent information;
* expose private thoughts as observable behavior;
* provide a generic post-hoc justification that could apply to any character.`;
}

function buildImmediateDecisionPrompt(
  input: StepInput,
  voice: AppraisalVoice,
  appraisalStep: FlowStep,
): string {
  const qualifier = VOICE_QUALIFIER[voice];
  return `Consolidated initial context:
"""
${priorField(input, STEP_CONSOLIDATE, "initial_context")}
"""
Initial appraisal:
"""
${priorStepBlock(input, appraisalStep)}
"""
The situation requires an immediate or near-immediate response. Generate the single most plausible action the character takes without reflective memories or deliberate reappraisal, and explain why.
The initial appraisal is written in the character’s ${qualifier}internal voice. Produce the externally observable action and causal explanation in third person. First-person language may appear only inside dialogue spoken by the character.
Use \`initial_action_tendency\` as the character’s most recent provisional impulse. Do not redo or revise the initial appraisal.
The action must contain only externally observable behavior. The explanation must cite the specific facts from the consolidated initial context that produced that behavior, naming each in the terms the context uses, must cite the time the situation allowed for a response and that it left no room to deliberate, and must not treat the appraisal’s own interpretations, emotions, or concerns as evidence on their own.
Do not introduce reflective information, compare alternative responses, invent information, or continue the scene beyond the character’s immediate response.
Return JSON only:
{
"action": "",
"explanation": ""
}`;
}

/**
 * The immediate branch's part 4, in the caller's voice.
 *
 * A genuinely different part from the reflective decision rather than a variant
 * of it: there is no reappraisal to treat as binding, so it anchors on part 3's
 * impulse directly and forbids the deliberation the reflective prompt assumes
 * has already happened. It takes the same key and fields, so Stage 4 reads
 * `decision.action` the same way whichever branch ran.
 */
export function immediateDecisionStep(options: {
  voice: AppraisalVoice;
  description: string;
  appraisalStep: FlowStep;
}): FlowStep {
  const { voice, description, appraisalStep } = options;
  return {
    key: STEP_DECISION,
    label: "Immediate decision",
    description,
    requiresContext: [],
    fields: [...DECISION_FIELDS],
    system: immediateDecisionSystem(voice),
    buildPrompt: (input) =>
      buildImmediateDecisionPrompt(input, voice, appraisalStep),
  };
}
