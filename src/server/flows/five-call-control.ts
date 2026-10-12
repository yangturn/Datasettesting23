import "server-only";

import {
  FIRST_PERSON_REFLECTIVE_STEPS,
  firstPersonAppraisalStep,
  fullFlowFirstPersonFlow,
} from "@/server/flows/full-flow-first-person";
import { DECISION_FIELDS, episodeContext } from "@/server/flows/revised-decision";
import {
  ALL_CONTEXT_KEYS,
  contextBlock,
  priorField,
  priorStepBlock,
  STEP_CONSOLIDATE,
  STEP_DECISION,
} from "@/server/flows/shared";
import type { Flow, FlowStep, StepInput } from "@/server/flows/types";

/**
 * Five-call control — Second Thought's five calls without the reconsideration.
 *
 * The question it answers is whether Second Thought's advantage comes from
 * *reappraising* the first impulse in the light of reflective memories, or
 * merely from spending a fifth call on the reflective memories at all. The
 * four-call immediate pipeline cannot separate those: it is one call shorter
 * and never sees the reflective memories. This control holds both fixed.
 *
 *   Call  Second Thought, 1st person          Five-call control
 *   1     Attribute extraction                 the same step object
 *   2     Consolidation                        the same step object
 *   3     Initial appraisal                    the same step object
 *   4     Reflective reappraisal: introduce    Recollection: introduce the same
 *         the memories, reconsider the         memories, restate their factual
 *         tendency                             content, leave the tendency alone
 *   5     Decision from the revised tendency   Decision from the initial tendency
 *
 * Parts 1 to 3 are not copies of the primary arm's parts: they are its step
 * objects, taken from the same array. The planner goes one step further and
 * copies their *outputs* from the primary arm's execution of the same scenario
 * rather than calling the model again (`seedFrom`), so the two arms are
 * identical up to part 4 by construction rather than by the hope that
 * temperature 0 is deterministic.
 *
 * Memory-access timing matches: reflective memories reach part 1 and are then
 * withheld until part 4 in both arms, and part 5 sees them verbatim in both.
 * Part 4's output is shorter here by design — a factual summary instead of a
 * deliberation — which is why each step records its token usage: five calls
 * do not make equal computation, and the comparison is reported with the
 * tokens actually spent.
 *
 * Time-sensitive scenarios are out of scope. Second Thought skips its
 * reappraisal there and runs the immediate pipeline, so there is nothing for
 * a control of the reappraisal to be compared against; the flow declares
 * `appliesTo` accordingly and the cell is neither run nor scored.
 *
 * Parts 4 and 5 are derived from the first-person reappraisal and the
 * reflective decision rather than written fresh, and differ from them only
 * where the design demands: the fourth part summarises instead of
 * deliberating, and the fifth is anchored on `initial_tendency` instead of
 * `revised_action_tendency`. Everything else — the voice, the citation rules
 * for the explanation, the ban on invention — is carried over, so the
 * instructions differ by as little as a control of this kind allows.
 */

export const STEP_RECALL = "recall";

// ---------------------------------------------------------------------------
// Part 4 — recollection of reflective memories, without reconsideration
// ---------------------------------------------------------------------------

const RECALL_SYSTEM = `You generate a character’s private, first-person recollection of reflective memories for a behavioral-prediction benchmark.

You are given:

1. The consolidated context available during the initial appraisal.
2. The character’s initial appraisal and provisional action tendency.
3. Reflective memories that become accessible through deliberate thought.

Restate the factual content of the reflective memories from inside the character’s subjective perspective. This is a recollection, not a reconsideration: the memories are brought to mind and summarized, and the initial appraisal and action tendency are left exactly as they are.

Rules:

* Treat all supplied information as canonical.
* Use only the supplied consolidated context, initial appraisal, and reflective memories.
* Write every prose field in the first person, using “I,” “me,” and “my” for the character’s own recollection.
* Refer to other people by name or with appropriate third-person pronouns.
* Write as the character’s private recollection, not as spoken dialogue or an external description of the character.
* Do not use analyst or model-planning language such as “the character thinks,” “the character should,” “I need to portray,” “the context indicates,” or “the optimal response is.”
* Remain within the character’s knowledge and subjective perspective.
* Do not invent biography, events, relationships, memories, values, goals, motivations, personality traits, capabilities, constraints, or observable details.
* Preserve the initial appraisal as the character’s genuine first reaction.
* Copy the supplied \`initial_action_tendency\` verbatim into \`initial_tendency\`. Do not summarize, reinterpret, strengthen, soften, or otherwise alter it.
* Summarize every supplied reflective memory: what happened, who was involved, when it took place where stated, and how it ended, in the terms the memory uses.
* Do not omit a memory because it seems irrelevant, and do not expand one because it seems important.
* Do not relate the memories to the present situation, the initial appraisal, or the action tendency.
* Do not compare possible responses, consider consequences, weigh constraints, or deliberate.
* Do not state what the memories mean, suggest, teach, or imply, and do not state whether they support or oppose the initial tendency.
* Do not revise, qualify, reinforce, or comment on the initial interpretation, emotional reaction, concerns, assumptions about others, or action tendency.
* Do not perform the final action or describe it as already performed.
* Avoid unnecessarily repeating the consolidated context or initial appraisal.
* Return exactly one JSON object with no additional prose.

Field definitions:

initial_tendency:
Copy the character’s \`initial_action_tendency\` from the initial appraisal verbatim. Preserve its first-person wording and exact meaning.

recalled_memories:
Restate the factual content of the supplied reflective memories in the first person, one memory after another, in the order they are supplied. Keep each to the facts the memory states. Do not interpret, evaluate, connect them to the present situation, or draw any conclusion from them.`;

function buildRecallPrompt(input: StepInput): string {
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

Generate the character’s private, first-person recollection of the reflective memories.

Restate their factual content only. Preserve the initial appraisal as the character’s genuine first reaction and copy \`initial_action_tendency\` verbatim into \`initial_tendency\`.

Write the recollection as the character’s own private recall using “I,” “me,” and “my.” Do not describe the character from an external perspective or use model-planning language.

Do not relate the memories to the present situation, reconsider the initial tendency, compare responses, invent information, or perform the final action.

Return JSON only:

{
"initial_tendency": "",
"recalled_memories": ""
}`;
}

/**
 * Part 4 — the memories are introduced at the same point, and with the same
 * inputs, as Second Thought's reappraisal, and then only restated.
 *
 * Keyed differently from the reappraisal on purpose. The two parts take the
 * same inputs but are different instructions, and a shared key would let
 * `substituteSteps` and the page treat one as a variant of the other.
 */
const recallStep: FlowStep = {
  key: STEP_RECALL,
  label: "Memory recollection",
  description:
    "The control's stand-in for the reflective reappraisal. It receives exactly what the reappraisal receives — part 2's account, part 3's appraisal, and the reflective memories — and does the one thing the reappraisal does that is not reconsideration: it brings the memories to mind, restating their factual content in the person's own first-person voice, every memory, in order. It copies the first impulse over verbatim and is forbidden from relating the memories to the situation, comparing responses, or saying what they imply.",
  requiresContext: ["reflective_memories"],
  fields: [
    { key: "initial_tendency", label: "Initial tendency", render: "prose" },
    { key: "recalled_memories", label: "Recalled memories", render: "prose" },
  ],
  system: RECALL_SYSTEM,
  buildPrompt: buildRecallPrompt,
};

// ---------------------------------------------------------------------------
// Part 5 — the decision, anchored on the initial tendency
// ---------------------------------------------------------------------------

const CONTROL_DECISION_SYSTEM = `You generate and explain a character’s final behavioral response for a behavioral-prediction benchmark.

You are given the character’s relevant context, first-person initial appraisal, and first-person recollection of reflective memories. Determine what the character actually does or says and explain why this response is most plausible for this particular character.

The initial appraisal and the recollection represent the character’s private subjective cognition. The character has recalled the reflective memories but has not reconsidered the initial action tendency. Convert that initial tendency into a single externally observable response without exposing unspoken thoughts as behavior or dialogue.

Rules:

* Treat all supplied information as canonical.
* Select the single most plausible immediate response for this character in the current situation.
* Use only the canonical episode context, the consolidated initial context, the initial appraisal, and the recollection.
* Ground the response in the character’s background, personality and response style, relationships, behavioral tendencies, current state, immediate memories, reflective memories, and initial appraisal.
* Preserve the initial appraisal as the character’s genuine first reaction.
* Treat \`initial_tendency\` as an unchanged record of the initial provisional impulse and as the proximal basis for the final response.
* Do not reconsider, revise, strengthen, soften, reverse, or replace the initial tendency, and do not perform a deliberation the character did not perform.
* Keep the final action consistent with the supplied \`initial_tendency\`, including any hesitation, qualification, delay, or compromise it already contains.
* Treat the recalled memories as evidence the explanation may cite, not as grounds for changing the action. A memory that pulls against the initial tendency does not alter the action; the explanation names it and states that the tendency was not reconsidered.
* Do not add a condition, qualification, delay, or compromise the initial tendency does not contain, and do not remove one it does.
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

One or two sentences. Name the one physical thing the character does and, when they speak, what they say. Do not add incidental gestures, movements, glances, or stage business the response does not require: every extra detail is a claim about the character that the context may not support.

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

Evidence means a specific fact stated in the canonical episode context or the consolidated initial context: a biography detail, relationship fact, established tendency, current-state item, immediate memory, reflective memory, or stated feature of the objective situation, including the time it allows for a response. Prefer the episode context’s own wording, which is the record the benchmark holds. Name each piece of evidence specifically, in the terms the context uses, so that a reader holding only the context can locate it. Where the context states a disposition, cite the concrete biography detail or past behavior that demonstrates it rather than the disposition label.

The explanation must:

* cite the evidence that most directly produced the final action, each item as a specific fact rather than a summary or a trait label, and every reflective memory that bears directly on the action, including those that pulled the other way, stating that none of them changed the tendency;
* when it mentions an interpretation, emotion, concern, assumption, or inclination from the initial appraisal, give it together with the cited evidence that produced it, never on its own;
* cite what the objective situation states about the time available to respond. Where it leaves room to think, say so, and say that the character recalled the reflective memories in that time without reconsidering the initial tendency. Where it asks for an answer now, do not claim a pause the situation does not give;
* state in one sentence that the initial tendency was carried into the final action unchanged, and how it produced that action;
* when the final action departs from an established tendency in the context, name that tendency in the context’s own terms, then cite the cue that overrode it; do not recast the situation to fit a different tendency;
* acknowledge the most important competing influence when one remains, citing its evidence.

Keep the account of the appraisal process to that one sentence and spend the rest of the explanation on the evidence and how it produced the behavior. Normally three to five sentences. Do not provide a generic post-hoc justification that could apply to any character.

Do not invent information, contradict the supplied appraisal, expose private thoughts as observable behavior, claim that the character reconsidered or that the memories changed the action, or treat an interpretation, emotion, concern, or inclination generated in the appraisal as evidence in its own right.`;

function buildControlDecisionPrompt(input: StepInput): string {
  return `Consolidated initial context:

"""
${priorField(input, STEP_CONSOLIDATE, "initial_context")}
"""

${episodeContext(input, true)}

Initial appraisal:

"""
${priorStepBlock(input, firstPersonAppraisalStep)}
"""

Recalled reflective memories:

"""
${priorStepBlock(input, recallStep)}
"""

Generate the single most plausible immediate action the character takes from the initial action tendency and explain why.

The initial appraisal and the recollection are written in the character’s first-person internal voice. Produce the externally observable action and causal explanation in third person. First-person language may appear only inside dialogue spoken by the character.

Use \`initial_tendency\` as the character’s most recent provisional inclination. The recalled memories were brought to mind and not acted on: do not reconsider, revise, or qualify the initial tendency in their light, and do not redo the appraisal.

The action must contain only externally observable behavior. The explanation must cite the specific facts from the canonical episode context and the consolidated initial context that produced that behavior, naming each in the terms the context uses, must cite the time the situation allowed for a response and describe the recollection within that time rather than claiming a pause the situation does not give, and must state in one sentence that the initial tendency was carried into the action unchanged.

Do not invent information, list alternative actions, or continue the scene beyond the character’s immediate response.

Return JSON only:

{
"action": "",
"explanation": ""
}`;
}

/**
 * Part 5 — same key and fields as every other flow's decision, so Stage 4
 * reads `decision.action` here exactly as it does elsewhere.
 *
 * Reads the same Stage 2 blocks as the reflective decision, reflective
 * memories included: by part 5 the memories have been introduced in both
 * arms, and withholding them here would make the control's explanation unable
 * to cite what its own part 4 just recalled.
 */
const controlDecisionStep: FlowStep = {
  key: STEP_DECISION,
  label: "Final decision",
  description:
    "Turns the person's first impulse — unchanged by the recollection — into the one thing an onlooker would see or hear, with the Stage 2 blocks in view so the explanation cites them in their own words. Part 3's initial tendency is treated as binding: the recalled memories may be cited as evidence, and must be named where they pulled the other way, but may not change, soften, strengthen, or qualify the action. Written from outside, since an action is observable behaviour.",
  requiresContext: ALL_CONTEXT_KEYS,
  fields: [...DECISION_FIELDS],
  system: CONTROL_DECISION_SYSTEM,
  buildPrompt: buildControlDecisionPrompt,
};

// ---------------------------------------------------------------------------
// The pipeline
// ---------------------------------------------------------------------------

/**
 * Parts 1 to 3 are indexed out of the primary arm's array rather than named,
 * so that this stays its first three steps *whatever they are* — if the
 * primary arm's part 2 were ever rewritten, the control would follow it, and
 * the registry's check that the shared prefix is shared by identity would
 * still hold.
 */
const CONTROL_STEPS: FlowStep[] = [
  ...FIRST_PERSON_REFLECTIVE_STEPS.slice(0, 3),
  recallStep,
  controlDecisionStep,
];

export const fiveCallControlFlow: Flow = {
  key: "five_call_control",
  label: "Five-call control",
  description:
    "Second Thought, 1st person with the reconsideration taken out and nothing else changed: the same first three parts — copied from that flow's own execution rather than re-run — then a fourth call that introduces the same reflective memories and only restates their factual content, and a fifth that decides from the initial tendency rather than a revised one. Five calls, the same memory-access timing, the same output requirements; token usage is recorded per part because five calls do not make equal computation. If Second Thought still scores higher, the gain is from reappraising, not from the extra call. Not run on time-sensitive scenarios, where Second Thought skips its reappraisal and there is nothing to control for.",
  steps: CONTROL_STEPS,
  appliesTo: (scenario) => scenario.situation_type !== "TIME_SENSITIVE",
  seedFrom: fullFlowFirstPersonFlow.key,
  outcome: {
    stepKey: STEP_DECISION,
    fieldKey: "action",
    reasonKey: "explanation",
  },
};
