import "server-only";

import type { FlowStep, StepInput } from "@/server/flows/types";

/**
 * The parts more than one flow is built from, and the helpers that read between
 * them.
 *
 * Every flow here models the same pipeline up to a point — extract what is
 * stable about the person, consolidate it with the moment, appraise it fast —
 * and then diverges in what happens next. Sharing the common parts verbatim is
 * what makes the divergence the only thing being compared; a second copy of the
 * consolidation prompt would drift and quietly become a second variable.
 *
 * Step keys are shared too, so `decision.action` means the same thing in every
 * flow and an evaluation stage can line them up without a per-flow mapping.
 */

export const STEP_ATTRIBUTES = "attributes";
export const STEP_CONSOLIDATE = "consolidate";
export const STEP_APPRAISAL = "appraisal";
export const STEP_DECISION = "decision";

/** Stage 2's episode context, in the order the prompts present it. */
export const ALL_CONTEXT_KEYS = [
  "relationship_profiles",
  "tendencies",
  "current_state",
  "immediate_memories",
  "reflective_memories",
];

/**
 * The same list without reflective memories — the material that only becomes
 * available through deliberate thought. Parts that model fast processing read
 * this one, so reflection has something left to contribute rather than being
 * handed what it was supposed to discover.
 */
export const PRE_REFLECTION_CONTEXT_KEYS = ALL_CONTEXT_KEYS.filter(
  (key) => key !== "reflective_memories",
);

/** A Stage 2 context block, or an empty line when the block came back blank. */
export function contextBlock(input: StepInput, key: string): string {
  return input.scenario.context[key]?.trim() ?? "";
}

/**
 * Both memory blocks under their own headings, or immediate memories alone when
 * the situation is time-sensitive.
 *
 * Reflective memories are by definition what becomes accessible through
 * deliberate thought. A flow with no separate reflective part has nowhere to
 * introduce them, so a situation that forces a response now reasons without
 * them; every other situation type gets both.
 *
 * Shared rather than copied per flow: the flows that gate memories this way are
 * meant to differ from each other in their reasoning structure, and a second
 * copy of this branch would quietly become a second variable — the same reason
 * the consolidation prompt is shared.
 */
export function availableMemories(input: StepInput): string {
  const immediate = `Immediate memories:\n${contextBlock(input, "immediate_memories")}`;

  if (input.scenario.situation_type === "TIME_SENSITIVE") return immediate;

  return [
    immediate,
    `Reflective memories:\n${contextBlock(input, "reflective_memories")}`,
  ].join("\n\n");
}

/**
 * A field produced by an earlier part, read back off the execution record.
 *
 * A part is only ever scheduled after the parts before it have been persisted,
 * so a missing key here means the step keys have been edited apart. That fails
 * loudly rather than interpolating a blank: a later part running on silently
 * absent evidence still produces confident-looking output, and nothing
 * downstream would show that it was reasoning from a hole.
 */
export function priorField(
  input: StepInput,
  stepKey: string,
  fieldKey: string,
): string {
  const prior = input.prior[stepKey];
  if (!prior || !(fieldKey in prior)) {
    throw new Error(
      `Needs "${fieldKey}" from the "${stepKey}" step, which is not in this execution.`,
    );
  }
  return prior[fieldKey];
}

/**
 * A whole earlier part, rendered as one labelled block.
 *
 * Some prompts take a previous part as a single input where that part produced
 * several fields. Its fields are laid out under their own keys, in the order the
 * step declares them, rather than as raw JSON — the surrounding prompts all
 * present their inputs as labelled prose, and the keys are what the step's own
 * field definitions call them, so nothing has to be renamed in transit.
 */
export function priorStepBlock(input: StepInput, step: FlowStep): string {
  return step.fields
    .map((field) => `${field.key}:\n${priorField(input, step.key, field.key)}`)
    .join("\n\n");
}

// ---------------------------------------------------------------------------
// Part 1 — stable attribute extraction
// ---------------------------------------------------------------------------

const ATTRIBUTES_SYSTEM = `You extract stable, decision-relevant character attributes from a biography for a behavioral-prediction benchmark.

You are given a character biography, an objective situation, and existing episode context. Identify the character’s values, culture, and background; roles and commitments; capabilities and constraints; and personality and response style that are directly stated or strongly supported by concrete evidence in the biography.

The biography is the sole evidentiary source for stable attributes. Use the objective situation and existing episode context only to select which established attributes are relevant. Do not use them to invent attributes, reinterpret ambiguous evidence, or construct attributes that favor a particular action.

Rules:

* Treat all supplied information as canonical.
* Every output item must be supported by explicit information or concrete behavioral evidence in the biography.
* Infer a stable attribute only when it is strongly supported by the biography.
* Do not infer a stable attribute from a single ambiguous action or a circumstance adequately explained by temporary or external factors.
* State attributes directly as concise facts.
* Do not use hedging or speculative language such as “probably,” “likely,” “may,” “might,” “could,” “seems,” or “would.”
* Do not describe what the character thinks, feels, wants, or does in the present situation.
* Do not predict, recommend, justify, favor, or imply an eventual action.
* Do not restate temporary emotions, present-situation logistics, memories, relationship details, or past episodes as stable attributes.
* Include only attributes relevant to understanding the character in the present situation.
* Do not assign MBTI types, Big Five labels, personality types, or numerical trait scores. Express supported dispositions in concrete psychological or behavioral language.
* Avoid duplicating the same attribute across fields.
* Return an empty string when the biography does not provide sufficient evidence for a field.
* Return exactly one JSON object with no additional prose.

Field definitions:

values_culture_and_background:
Extract enduring principles, priorities, standards, beliefs, internalized cultural norms, or formative background influences explicitly stated or strongly demonstrated in the biography.

An attribute may be inferred from:

* a repeated pattern of choices;
* a clearly stated principle or opinion;
* sacrifices repeatedly made for the same priority;
* consistent reactions across multiple events;
* an explicitly described influence of upbringing, culture, education, occupation, or formative experience.

Do not infer a value from a single ambiguous action. Do not infer cultural values from demographic identity alone. When culture or background is relevant, report only an influence, norm, or belief that the biography shows this particular character has internalized.

roles_and_commitments:
Extract established social roles, responsibilities, loyalties, promises, or ongoing obligations.

A role or commitment must be supported by:

* an explicitly stated relationship or position;
* a recurring responsibility;
* an established promise or obligation;
* sustained participation in an activity or institution.

Do not treat a temporary task, situational expectation, or one-time favor as a stable role or commitment.

capabilities_and_constraints:
Extract established abilities, knowledge, authority, resources, limitations, or recurring practical restrictions.

A capability or constraint must be supported by:

* demonstrated skill, knowledge, authority, or experience;
* an established resource or lack of access;
* a stated physical, financial, social, linguistic, or practical limitation;
* a recurring restriction demonstrated across the biography.

Do not convert personality, preferences, temporary emotions, current physical conditions, or present-situation logistics into capabilities or constraints.

personality_and_response_style:
Extract stable psychological dispositions relevant to how the character generally interprets experiences, responds emotionally, interacts with others, and regulates behavior.

Relevant dispositions include:

* emotional sensitivity and reactivity;
* sensitivity to criticism, rejection, uncertainty, conflict, or loss of control;
* sociability, assertiveness, trust, compassion, guardedness, or conflict style;
* impulsiveness, deliberation, self-control, or emotional restraint;
* established coping patterns such as confrontation, withdrawal, suppression, reassurance-seeking, rumination, humor, or problem-solving;
* preference for routine or novelty and tolerance for ambiguity or change.

A disposition must be supported by:

* an explicit description of the character;
* a repeated behavioral pattern;
* consistent reactions across multiple events;
* an established interpersonal, coping, or self-regulation pattern.

Express each disposition concretely. For example, describe sensitivity to criticism and a tendency to withdraw after conflict rather than labeling the character “high in neuroticism” or “introverted.”

Do not:

* infer a disposition from a single incident;
* mistake behavior caused by external constraints for personality;
* convert a temporary emotion or current state into a stable trait;
* merely repeat an episode already provided under tendencies;
* describe how the disposition manifests in the present situation;
* state an if–then pattern tailored so narrowly to the present situation that it implies the eventual action.`;

function buildAttributesPrompt(
  input: StepInput,
  withReflectiveMemories: boolean,
): string {
  const reflective = withReflectiveMemories
    ? `

Reflective memories:
"""
${contextBlock(input, "reflective_memories")}
"""`
    : "";

  return `Character biography:

"""
${input.description.description}
"""

Current objective situation:

"""
${input.scenario.situation}
"""

Existing episode context:

Relationship profiles:
"""
${contextBlock(input, "relationship_profiles")}
"""

Tendencies:
"""
${contextBlock(input, "tendencies")}
"""

Current emotion/state:
"""
${contextBlock(input, "current_state")}
"""

Immediate memories:
"""
${contextBlock(input, "immediate_memories")}
"""${reflective}

Identify the character’s stable attributes that are relevant to the current situation.

Use only the biography as evidence for stable attributes. Consider the character’s stated values, internalized cultural influences, upbringing, experiences, relationships, education, occupation, recurring behavior, emotional patterns, interpersonal style, and broader background.

Use the objective situation and existing episode context only to determine which biography-supported attributes are relevant. Do not use them to invent attributes, resolve ambiguous biography evidence, or justify a particular action.

State each attribute directly as a fact. Do not describe or imply what the character will do in the current situation.

Return JSON only:

{
"values_culture_and_background": "",
"roles_and_commitments": "",
"capabilities_and_constraints": "",
"personality_and_response_style": ""
}`;
}

/**
 * Part 1, built for a flow that either does or does not admit reflective
 * memories.
 *
 * The system prompt is identical either way — it only ever speaks of "existing
 * episode context" — so the two variants differ by exactly one block of the user
 * prompt. A flow that models immediate response drops it, because attributes
 * extracted with reflective material in view carry that material forward into
 * every later part, and the flow would be reasoning from memories it claims the
 * character has no access to.
 *
 * `personality_and_response_style` is the one field here that Stage 2 also
 * speaks to: its `tendencies` block carries established patterns of past
 * behavior. They are not the same thing, and the prompt keeps them apart — a
 * tendency is an episode already supplied, a disposition is the standing
 * psychological pattern the biography evidences, and the field is explicitly
 * forbidden from restating the former as the latter.
 */
export function makeAttributesStep(withReflectiveMemories: boolean): FlowStep {
  return {
    key: STEP_ATTRIBUTES,
    label: "Attribute extraction",
    description: `Pulls the person's enduring attributes out of the biography — what they value, what they are committed to, what they can and cannot do, and how they characteristically react, cope, and deal with other people. The situation and episode context only decide which attributes are relevant; they may not create one, and the step is forbidden from reasoning toward an action.${
      withReflectiveMemories
        ? ""
        : " This flow withholds reflective memories here, so nothing drawn from them can reach the later parts."
    }`,
    requiresContext: withReflectiveMemories
      ? ALL_CONTEXT_KEYS
      : PRE_REFLECTION_CONTEXT_KEYS,
    fields: [
      {
        key: "values_culture_and_background",
        label: "Values, culture and background",
        render: "facts",
      },
      {
        key: "roles_and_commitments",
        label: "Roles and commitments",
        render: "facts",
      },
      {
        key: "capabilities_and_constraints",
        label: "Capabilities and constraints",
        render: "facts",
      },
      {
        key: "personality_and_response_style",
        label: "Personality and response style",
        render: "facts",
      },
    ],
    system: ATTRIBUTES_SYSTEM,
    buildPrompt: (input) => buildAttributesPrompt(input, withReflectiveMemories),
  };
}

// ---------------------------------------------------------------------------
// Part 2 — consolidation
// ---------------------------------------------------------------------------

const CONSOLIDATE_SYSTEM = `You consolidate established character and episode information into a detailed, coherent representation for an initial psychological appraisal.
You are given a full character biography, an objective situation, and structured character context. Rewrite the supplied information into one organized account containing all established information that could materially affect the character’s immediate appraisal and subsequent behavior.
This account will be the primary evidence used by a later model. Preserve enough detail to support psychologically grounded interpretation and decision-making, including relevant stable personality dispositions and response patterns.
The account represents information available before deliberate reflection. Do not include reflective memories or information that becomes accessible only through deliberate reconsideration.
Rules:

* Treat all supplied information as canonical.
* Preserve all supplied information that could materially affect the character’s immediate appraisal or subsequent response.
* Remove biographical information with no plausible bearing on the present situation.
* Combine overlapping information and remove unnecessary repetition without losing meaningful nuance.
* Preserve conflicting, competing, and ambivalent influences.
* Do not favor information supporting one particular response.
* Organize the account into exactly three sections:
   1. RELEVANT CHARACTER BACKGROUND
   2. OBJECTIVE SITUATION
   3. PRE-APPRAISAL STATE AND ACCESSIBLE MEMORIES
* RELEVANT CHARACTER BACKGROUND should integrate relevant biography, values, cultural influences, background, roles, commitments, capabilities, constraints, stable personality and response style, relationship history, and behavioral tendencies.
* Incorporate relevant personality and response-style information, including established emotional sensitivities, interpersonal style, self-regulation, coping patterns, and tolerance for uncertainty or change.
* Preserve personality and response-style information as stable background. Do not apply it to the present situation by stating how the character currently interprets the event, what emotion it activates, or which response it produces.
* OBJECTIVE SITUATION should contain only externally observable facts about what is currently happening.
* PRE-APPRAISAL STATE AND ACCESSIBLE MEMORIES should contain the character’s current emotional, physical, and cognitive condition, recent influences, and memories directly cued by the present situation.
* Keep objective facts separate from subjective or internal information.
* Do not include reflective memories or reflective context.
* Do not perform the psychological appraisal.
* Do not introduce interpretations of the situation, assumptions about other people, newly activated goals, expected consequences, possible responses, situation-specific action tendencies, or a final decision.
* Do not convert stable personality dispositions into claims about the character’s present thoughts, feelings, motivations, or intended behavior.
* Do not invent or embellish facts, events, relationships, memories, motivations, traits, response patterns, or cultural influences.
* Use third-person prose and state information directly.
* Retain specific names, relationships, relevant timing, prior behavior, practical constraints, personality dispositions, and contextual details when they could affect the appraisal.
* Write approximately 500–1000 words when supported by the source material.
* Prefer using fewer than 500 words over repeating, embellishing, interpreting, or inventing information to meet the target.
* Return exactly one JSON object with no additional prose.`;

function buildConsolidatePrompt(input: StepInput): string {
  return `Character biography:
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
Tendencies:
"""
${contextBlock(input, "tendencies")}
"""
Current emotion/state:
"""
${contextBlock(input, "current_state")}
"""
Immediate memories:
"""
${contextBlock(input, "immediate_memories")}
"""
Values, culture, and background:
"""
${priorField(input, STEP_ATTRIBUTES, "values_culture_and_background")}
"""
Roles and commitments:
"""
${priorField(input, STEP_ATTRIBUTES, "roles_and_commitments")}
"""
Capabilities and constraints:
"""
${priorField(input, STEP_ATTRIBUTES, "capabilities_and_constraints")}
"""
Personality and response style:
"""
${priorField(input, STEP_ATTRIBUTES, "personality_and_response_style")}
"""
Consolidate the supplied information into a detailed initial-context account.
Include all established information that could materially affect the character’s immediate appraisal and eventual response. Integrate relevant personality and response-style information with the character’s biography, values, roles, constraints, relationships, and behavioral history. Remove unrelated biography and unnecessary repetition while preserving meaningful details, tensions, and competing influences.
Present personality and response style only as established background. Do not apply those dispositions to the current situation, perform the appraisal, introduce a situation-specific action tendency, or imply the character’s eventual response.
Do not include reflective memories.
Return JSON only:
{
"initial_context": "RELEVANT CHARACTER BACKGROUND\\n\\n...\\n\\nOBJECTIVE SITUATION\\n\\n...\\n\\nPRE-APPRAISAL STATE AND ACCESSIBLE MEMORIES\\n\\n..."
}`;
}

/**
 * Part 2 — consolidation into the pre-appraisal account.
 *
 * One field rather than three, because the prompt asks for a single written
 * account whose three sections are headings inside it, not separate outputs.
 * Splitting them into keys here would be a different instruction than the one
 * supplied.
 *
 * All four of part 1's fields are read here, dispositions included. The prompt
 * carries them as *background* and forbids applying them to the moment — no
 * present interpretation, no activated emotion, no situation-specific action
 * tendency. That line is what keeps part 2 a consolidation rather than a head
 * start on part 3, which is the only part meant to turn a disposition into a
 * reaction.
 */
export const consolidateStep: FlowStep = {
  key: STEP_CONSOLIDATE,
  label: "Consolidation",
  description:
    "Rewrites the biography, the situation, the pre-reflection episode context, and part 1's attributes into one organised account: relevant background, what is objectively happening, and the state and cued memories the person carries in. Dispositions are carried as standing background rather than applied to the moment. Competing and ambivalent influences are kept rather than resolved, and the appraisal itself is left to a later part.",
  requiresContext: PRE_REFLECTION_CONTEXT_KEYS,
  fields: [{ key: "initial_context", label: "Initial context", render: "prose" }],
  system: CONSOLIDATE_SYSTEM,
  buildPrompt: buildConsolidatePrompt,
};

// ---------------------------------------------------------------------------
// Part 3 — initial appraisal
// ---------------------------------------------------------------------------

const APPRAISAL_SYSTEM = `You simulate a character’s initial psychological appraisal of a situation for a behavioral-prediction benchmark.

You are given a consolidated account containing the relevant character background, objective situation, and the character’s pre-appraisal state and immediately accessible memories.

Generate the character’s immediate subjective appraisal before deliberate reflection.

This appraisal represents fast and intuitive processing. It may be incomplete or biased by the character’s background, relationships, tendencies, current state, and immediately accessible memories.

Rules:
- Treat the supplied context as canonical.
- Reason from the character’s subjective perspective.
- Use only information contained in the supplied initial context.
- Ground every interpretation, emotion, concern, assumption, and impulse in the supplied context.
- Distinguish the character’s subjective interpretation from objective facts.
- Do not invent biography, relationships, events, memories, values, capabilities, or constraints.
- Do not introduce or reconstruct reflective memories.
- Do not conduct extended deliberation or systematically compare possible responses.
- Do not calculate distant or detailed consequences.
- Do not resolve competing concerns.
- Do not make a final decision or describe an action as already performed.
- The initial action tendency must remain a provisional impulse, not a final choice.
- Preserve ambivalence when multiple influences are immediately active.
- Refer to the character in the third person.
- State the appraisal directly rather than using speculative language such as “perhaps,” “possibly,” “might,” or “would.”
- Keep the output concise and avoid repeating the supplied context.
- Return exactly one JSON object with no additional prose.

Field definitions:

initial_interpretation:
Describe what the event immediately appears to mean to the character. Capture the character’s first subjective understanding of the situation without treating it as objectively correct.

initial_emotional_reaction:
Describe the emotions produced, intensified, or changed by the event. Account for the character’s emotional, physical, and cognitive state immediately before it occurred.

activated_concerns:
Identify the values, needs, preferences, roles, commitments, relationships, or vulnerabilities that become immediately relevant. Preserve competing concerns without determining which should prevail.

automatic_theory_of_mind:
Describe the character’s immediate assumptions about what the other relevant people want, expect, feel, or intend. Present these as the character’s subjective impressions rather than verified facts.

initial_action_tendency:
Describe the character’s first behavioral impulse, such as approaching, avoiding, accepting, refusing, delaying, questioning, reassuring, defending, or withdrawing. Connect it to the immediate appraisal without turning it into a final decision.`;

function buildAppraisalPrompt(input: StepInput): string {
  return `Consolidated initial context:

"""
${priorField(input, STEP_CONSOLIDATE, "initial_context")}
"""

Generate the character’s immediate appraisal of the situation before deliberate reflection.

Use only the supplied context. Do not introduce reflective memories, conduct extended reasoning, systematically compare responses, or make the final decision.

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
 * Part 3 — the fast, pre-reflective appraisal.
 *
 * Its only input is part 2's consolidated account: not the biography, not the
 * situation, not any Stage 2 block. That bottleneck is the design, not an
 * omission — the appraisal is meant to run on what consolidation made
 * available, so anything part 2 dropped is genuinely unavailable here rather
 * than quietly reachable around the side. It is the one part that reads no
 * Stage 2 context directly, hence the empty `requiresContext`.
 */
export const appraisalStep: FlowStep = {
  key: STEP_APPRAISAL,
  label: "Initial appraisal",
  description:
    "Reads only part 2's account and produces the character's fast, intuitive first read of the moment — what it appears to mean, what it stirs up, which concerns light up, what they assume of the other people, and the first impulse. Competing concerns are left unresolved and the impulse stays provisional; no decision is made here.",
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
  system: APPRAISAL_SYSTEM,
  buildPrompt: buildAppraisalPrompt,
};
