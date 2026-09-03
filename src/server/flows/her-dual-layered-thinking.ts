import "server-only";

import {
  ALL_CONTEXT_KEYS,
  availableMemories,
  contextBlock,
  priorField,
  STEP_DECISION,
} from "@/server/flows/shared";
import type { Flow, FlowStep, StepInput } from "@/server/flows/types";

/**
 * Her Dual Layered Thinking — HER-style simulation in two layers.
 *
 * Not the shared spine. Where Full Flow and Immediate Flow extract attributes,
 * consolidate them into an account, and appraise that account, this flow hands
 * both of its parts the canonical material directly and splits the work by
 * *perspective* rather than by pipeline stage:
 *
 *   Part 1 — system thinking: the model's own hidden planning of how to portray
 *   the character in one next turn, describing them in the third person.
 *
 *   Part 2 — role thinking: the character's actual subjective experience in the
 *   moment, in their own first-person voice, followed by the observable turn —
 *   following part 1's plan only where the canonical context supports it.
 *
 *   Part 3 — conversion: part 2's turn rendered in the third-person action and
 *   explanation every other flow's final part reports.
 *
 * So there is no consolidation bottleneck here and no fast/deliberate split.
 * Parts 1 and 2 see the same evidence; what differs between them is who is
 * reasoning. That is the variable this flow contributes to the comparison.
 *
 * Part 3 is not a third reasoner. It re-expresses what part 2 already produced,
 * and its prompt forbids it from selecting, revising or continuing anything — so
 * the response being scored is still part 2's, only in the form the other flows
 * report theirs in.
 */

const STEP_SYSTEM_THINKING = "system_thinking";
const STEP_ROLE_RESPONSE = "role_response";

/**
 * Both parts call `availableMemories` with the same scenario, so they always see
 * the same memories — part 2 can neither gain nor lose material relative to the
 * plan it is following. The time-sensitive gate itself lives in `shared.ts`,
 * since Direct Zero Shot applies the same rule.
 */

// ---------------------------------------------------------------------------
// Part 1 — system thinking
// ---------------------------------------------------------------------------

const SYSTEM_THINKING_SYSTEM = `You perform the hidden system-thinking stage of HER-style character simulation.

Your task is to plan how to portray the supplied character in exactly one next turn. Analyze the character profile, current scene, relevant relationships, available background information, and response constraints. Construct a coherent trajectory for the character’s private role thinking, observable behavior, and speech.

Write from the model’s planning perspective while describing the character in the third person.

Model-level first-person language may be used only to describe the portrayal task:

Correct:
“I need to portray Elena as guarded but still concerned about Daniel.”

Incorrect:
“I feel guarded, and I do not want Daniel near me.”

The second example incorrectly speaks as the character and belongs in role thinking rather than system thinking.

Consider:

* the character’s established personality, values, knowledge, motivations, and behavioral patterns;
* the objective facts, timing, opportunities, and constraints of the situation;
* the character’s relationships with the people involved;
* the character’s current emotional, physical, and cognitive condition;
* relevant established tendencies and prior behavior;
* available memories and background information;
* what the character can actually know or observe;
* how the character’s immediate internal state and motivation should be expressed through the next turn;
* how private thought, physical behavior, and speech should remain mutually consistent.

Rules:

* Treat all supplied information as canonical.
* Use only the supplied information.
* Ensure every planned interpretation, motivation, and response is traceable to the supplied context.
* Do not invent facts, relationships, memories, tendencies, personality traits, goals, values, capabilities, constraints, knowledge, or events.
* Do not reinterpret ambiguous information merely to support a preferred response.
* Respect the character’s knowledge boundaries.
* Do not plan the response using information that is unavailable to the character.
* Do not treat another person’s private thoughts, emotions, or intentions as known unless the supplied context explicitly establishes that the character knows them.
* The character may infer another person’s state only from observable behavior, speech, established history, or canonical information available to the character.
* Refer to other people by name, role, or relationship. Never refer to anyone as “the user.”
* Identify the character’s supported immediate interpretation, emotional state, motivation, and interpersonal stance.
* Plan how the character’s established personality and relationship perspective should appear in the response.
* Plan exactly one next-turn trajectory.
* The planned trajectory may include private role thinking, physical action, speech, or any supported combination of them.
* Do not generate multiple candidate responses or conduct an exhaustive option analysis.
* Do not write from the character’s first-person perspective.
* Do not place first-person character thoughts inside \`system_thinking\`.
* Do not generate the final role thinking, action, or dialogue as already performed.
* Do not continue the scene beyond the character’s next single turn.
* Do not predict subsequent reactions or events.
* The system-thinking plan applies only to the current turn. It is not part of the character’s memory or lived experience.
* Return exactly one JSON object with no additional prose.`;

function buildSystemThinkingPrompt(input: StepInput): string {
  return `Character description:

"""
${input.description.description}
"""

Objective situation:

"""
${input.scenario.situation}
"""

Relationship profiles:

"""
${contextBlock(input, "relationship_profiles")}
"""

Established behavioral tendencies:

"""
${contextBlock(input, "tendencies")}
"""

Current emotional, physical, and cognitive state:

"""
${contextBlock(input, "current_state")}
"""

Available memories and background information:

"""
${availableMemories(input)}
"""

Analyze the persona and scene constraints and construct a hidden system-level plan for exactly one next turn.

Write from the model’s planning perspective while referring to the character in the third person. Plan how the character’s private role thinking, observable behavior, and speech should express the character’s supported internal state, motivation, personality, and relationship perspective.

Do not speak as the character, generate multiple alternatives, or write the final response as already performed.

Return JSON only:

{
"system_thinking": ""
}`;
}

/**
 * Part 1 — the outside view.
 *
 * One field, because the supplied prompt asks for one: the analysis and the plan
 * are a single written account, and splitting them into keys here would be a
 * different instruction than the one supplied.
 */
const systemThinkingStep: FlowStep = {
  key: STEP_SYSTEM_THINKING,
  label: "System thinking",
  description:
    "Plans the turn from outside the character, in the model's own planning voice: which supplied evidence bears on the response, the character's supported interpretation, motivation and interpersonal stance, and one trajectory for their private thought, behaviour and speech. No alternatives are weighed, and nothing is performed here.",
  requiresContext: ALL_CONTEXT_KEYS,
  fields: [
    { key: "system_thinking", label: "System thinking", render: "prose" },
  ],
  system: SYSTEM_THINKING_SYSTEM,
  buildPrompt: buildSystemThinkingPrompt,
};

// ---------------------------------------------------------------------------
// Part 2 — role thinking and response
// ---------------------------------------------------------------------------

const ROLE_THINKING_SYSTEM = `You perform the role-level thinking and response stage of HER-style character simulation.

You are given canonical character context and a hidden system-thinking plan written from the model’s perspective. Generate the character’s private role thinking and exactly one next observable response.

Role thinking represents the character’s actual subjective experience immediately before or during the response. It may contain the character’s thoughts, emotions, perceptions, memories, private reactions, immediate intentions, hesitation, or inner conflict.

Role thinking is not an external analysis or a post-hoc explanation of why an action is plausible.

Rules:

* Treat the supplied character context as canonical.
* Use only the supplied character context and supported portions of the system-thinking plan.
* Follow the system-thinking plan when it is consistent with the canonical context.
* Ignore any statement in system thinking that contradicts, embellishes, or exceeds the canonical context.
* Do not repeat the system-thinking analysis in different words.
* Do not mention system thinking, role thinking, HER, prompts, context blocks, or supplied fields.
* Generate exactly one next turn for the supplied character.
* Do not speak, think, or act for another character.
* Do not reconsider the entire situation from the beginning.
* Do not generate new alternatives or perform an exhaustive option comparison.
* Do not invent facts, relationships, memories, tendencies, personality traits, goals, values, capabilities, constraints, knowledge, or events.
* Keep the character within their own knowledge and perceptual boundaries.
* The character may directly access only their own thoughts, emotions, motivations, perceptions, and available memories.
* Do not give the character direct access to another person’s private thoughts, emotions, or motivations.
* Any assumption about another person must remain an inference based on observable behavior, speech, established history, or canonical information available to the character.
* Do not turn the character’s subjective impression into an objective fact.
* When the character refers to their own thoughts, feelings, desires, memories, or intended actions, write in the first person using “I,” “me,” and “my.”
* When the character observes or judges another person, third-person references are natural.
* Match the character’s established personality, emotional style, knowledge, relationships, and manner of thinking.
* Role thinking may be emotionally incomplete, conflicted, biased, associative, restrained, or impulsive when appropriate.
* Do not force role thinking into polished, comprehensive, rational, moral, or socially desirable reasoning.
* Do not make role thinking a generic justification that could apply to any character.
* Keep the role thinking causally consistent with the observable response.
* When the role thinking contains an intention or plan, it must precede the corresponding behavior.
* Generate only one immediate response.
* The observable response may contain physical action, speech, or both.
* Physical behavior must be concrete and externally observable.
* Include the character’s spoken words when the character speaks.
* Do not place hidden thoughts, emotions, motives, or analysis inside the observable action.
* Do not narrate another person’s response.
* Do not continue the scene beyond the character’s single turn.
* Do not narrate later consequences.
* Return exactly one JSON object with no additional prose.

Field definitions:

role_thinking:
Write the character’s private subjective thought immediately before or during the response.

Use first person for the character’s own internal state. Include only thoughts, emotions, perceptions, memories, intentions, or conflicts supported by the supplied context and system-thinking plan.

Do not write an external explanation, summarize the system-thinking plan, or justify the response to an evaluator.

action:
Describe only the character’s immediate, externally observable response.

Include physical behavior and spoken words when relevant. Do not include unspoken thoughts, hidden emotions, motives, analysis, another person’s response, or later events.`;

function buildRoleThinkingPrompt(input: StepInput): string {
  return `Character description:

"""
${input.description.description}
"""

Objective situation:

"""
${input.scenario.situation}
"""

Relationship profiles:

"""
${contextBlock(input, "relationship_profiles")}
"""

Established behavioral tendencies:

"""
${contextBlock(input, "tendencies")}
"""

Current emotional, physical, and cognitive state:

"""
${contextBlock(input, "current_state")}
"""

Available memories and background information:

"""
${availableMemories(input)}
"""

Hidden system-thinking plan:

"""
${priorField(input, STEP_SYSTEM_THINKING, "system_thinking")}
"""

Generate the character’s private role thinking and next single observable response.

The role thinking must express the character’s own subjective experience rather than explaining the response from an external perspective. Use first person for the character’s own thoughts, emotions, memories, and intentions.

Follow the system-thinking plan only where it remains consistent with the canonical character context. Do not repeat or mention the plan.

Do not generate alternative responses, speak or act for another character, or continue the scene beyond this character’s next turn.

Return JSON only:

{
"role_thinking": "",
"action": ""
}`;
}

/**
 * Part 2 — where the response is actually chosen.
 *
 * `role_thinking` replaces the `explanation` this part used to produce, and the
 * difference is not only the name: an explanation justified the response to a
 * reader, while role thinking *is* the character's experience of the moment, in
 * their own voice. The supplied prompt explicitly forbids the former in the
 * field that replaced it.
 *
 * Keyed `role_response` rather than `decision`, now that part 3 exists: the
 * scored output is `decision.action` in every flow, and leaving the character's
 * own first-person telling under that key would have Stage 4 comparing HER's
 * voice against the other flows' onlookers.
 */
const roleThinkingStep: FlowStep = {
  key: STEP_ROLE_RESPONSE,
  label: "Role thinking and response",
  description:
    "Steps inside the character: their actual subjective experience in the instant before acting, in their own first-person voice, and the one observable turn it produces, speech included. Part 1's plan is followed only where the canonical context supports it — anything in it that contradicts or exceeds that context is ignored rather than acted on.",
  requiresContext: ALL_CONTEXT_KEYS,
  fields: [
    { key: "role_thinking", label: "Role thinking", render: "prose" },
    { key: "action", label: "Action", render: "prose" },
  ],
  system: ROLE_THINKING_SYSTEM,
  buildPrompt: buildRoleThinkingPrompt,
};

// ---------------------------------------------------------------------------
// Part 3 — conversion to the benchmark's third-person format
// ---------------------------------------------------------------------------

const CONVERSION_SYSTEM = `You convert a HER-style role-level response into the standardized output format used by a behavioral-prediction benchmark.

You are given canonical character context, the character’s private first-person role thinking, and the character’s resulting observable response. Convert the supplied response into:

1. A third-person description of the character’s externally observable action.
2. A third-person causal explanation of how the character’s private role thinking produced that action.

This is a representation-conversion step, not another decision-making or reasoning stage. Preserve the response selected in the preceding role-thinking stage.

Rules:

* Treat all supplied information as canonical.
* Use only the supplied character context, role thinking, and action.
* Treat the supplied action as authoritative.
* Do not select, revise, improve, replace, strengthen, soften, or reinterpret the action.
* Preserve all externally observable behavior and spoken words from the supplied action.
* Make only the grammatical changes necessary to express the action clearly in the third person.
* Do not add new gestures, speech, hesitation, qualification, or other behavior.
* Do not remove meaningful observable details.
* Do not continue the scene beyond the supplied response.
* Do not describe another person’s reaction or any subsequent event.
* Convert the first-person role thinking into a concise third-person causal explanation.
* Preserve the meaning, emotional tone, uncertainty, ambivalence, bias, and incompleteness of the original role thinking.
* Use the canonical context only to clarify references and ground causal influences already expressed in the role thinking.
* Do not introduce a new motive, concern, memory, interpretation, or causal influence merely because it appears elsewhere in the context.
* Do not access or mention the hidden system-thinking plan.
* Do not perform additional deliberation, compare alternatives, or generate a new justification for the response.
* Do not invent facts, relationships, memories, tendencies, personality traits, values, motivations, capabilities, constraints, or events.
* When the role thinking contains a subjective assumption about another person, preserve it as the character’s interpretation rather than presenting it as an objective fact.
* Refer to the character by name or with appropriate third-person pronouns.
* Write both output fields in the third person, except for the character’s spoken words inside direct quotation marks.
* Do not mention HER, role thinking, system thinking, prompts, supplied fields, conversion, or the preceding stage.
* Ensure the action and explanation describe the same response.
* Return exactly one JSON object with no additional prose.

Field definitions:

action:
Describe the supplied immediate response in clear third-person language. Include only externally observable behavior and spoken words. Preserve the behavioral meaning and dialogue of the supplied action. First-person language may appear only inside direct dialogue spoken by the character.

Do not include:

* unspoken thoughts;
* hidden emotions or motives;
* psychological analysis;
* causal explanation;
* alternative behavior;
* responses from other people;
* later events.

explanation:
Convert the supplied private role thinking into a concise third-person causal explanation of the supplied action. Explain:

* how the character subjectively interpreted the immediate situation;
* which emotions, concerns, memories, intentions, or internal conflicts became active;
* how those internal influences produced the supplied observable response.

Include only influences expressed in the role thinking or directly necessary to clarify it using the canonical context.

Do not:

* expose the explanation as a quotation of private thought;
* present subjective assumptions as objective facts;
* reconstruct the hidden system-thinking plan;
* add a more rational, moral, complete, or socially desirable justification;
* introduce reflective reasoning absent from the role thinking;
* revise or reevaluate the selected action;
* provide a generic post-hoc explanation.`;

function buildConversionPrompt(input: StepInput): string {
  return `Character description:

"""
${input.description.description}
"""

Objective situation:

"""
${input.scenario.situation}
"""

Relationship profiles:

"""
${contextBlock(input, "relationship_profiles")}
"""

Established behavioral tendencies:

"""
${contextBlock(input, "tendencies")}
"""

Current emotional, physical, and cognitive state:

"""
${contextBlock(input, "current_state")}
"""

Available memories and background information:

"""
${availableMemories(input)}
"""

Private role thinking:

"""
${priorField(input, STEP_ROLE_RESPONSE, "role_thinking")}
"""

Observable response:

"""
${priorField(input, STEP_ROLE_RESPONSE, "action")}
"""

Convert the supplied role-level response into the benchmark’s third-person action-and-explanation format.

Preserve the observable response exactly in meaning. Make only the grammatical changes required to express it in the third person.

Convert the private role thinking into a concise third-person causal explanation. Preserve its original meaning, emotional tone, uncertainty, and conflict. Do not add new reasoning or a post-hoc justification.

Do not use or reconstruct hidden system thinking, reconsider the response, invent information, or continue the scene.

Return JSON only:

{
"action": "",
"explanation": ""
}`;
}

/**
 * Part 3 — the flow's reported output.
 *
 * Keyed `decision` with `action` and `explanation`, the same shape every other
 * flow's final part produces, which is the whole point of the part: HER now
 * answers in the form Stage 4 already reads instead of in the character's own
 * voice.
 *
 * It reads the canonical context but is not given part 1's plan, per the
 * supplied prompt — it converts what part 2 arrived at, and handing it the plan
 * would invite it to render the turn that was planned rather than the one that
 * was produced.
 *
 * Note that the context here is not evidence for a new response. The prompt
 * admits it only to clarify references and ground influences the role thinking
 * already expresses, and forbids importing a motive merely because the context
 * contains one — so a part with all the material a reasoner would need is still
 * constrained to re-expressing part 2's answer.
 */
const conversionStep: FlowStep = {
  key: STEP_DECISION,
  label: "Response conversion",
  description:
    "Re-expresses part 2's turn in the third person: what an onlooker would see and hear, and how the person's own private thinking produced it. Nothing is decided, weighed or continued here — the action is treated as authoritative and only its grammar changes, and the explanation preserves the tone, uncertainty and bias of the thinking it converts rather than tidying it into a better justification.",
  requiresContext: ALL_CONTEXT_KEYS,
  fields: [
    { key: "action", label: "Action", render: "prose" },
    { key: "explanation", label: "Explanation", render: "prose" },
  ],
  system: CONVERSION_SYSTEM,
  buildPrompt: buildConversionPrompt,
};

export const herDualLayeredThinkingFlow: Flow = {
  key: "her_dual_layered_thinking",
  label: "Her Dual Layered Thinking",
  description:
    "HER-style simulation in two layers over the same canonical material: a hidden system-thinking plan for one next turn, written from outside the character, then the character's own first-person role thinking and the observable turn itself. A third part converts that turn into the third-person action and explanation the other flows report, without reconsidering it. Reflective memories are withheld when the situation is time-sensitive.",
  steps: [systemThinkingStep, roleThinkingStep, conversionStep],
  outcome: {
    stepKey: STEP_DECISION,
    fieldKey: "action",
    reasonKey: "explanation",
  },
};
