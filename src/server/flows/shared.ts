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

You are given a character biography, an objective situation, and existing episode context. Identify values and beliefs, roles and commitments, and capabilities and constraints that are directly stated or strongly supported by concrete evidence in the biography.

Use the situation only to select which established attributes are relevant. Do not use it to invent attributes or reinterpret ambiguity in favor of a particular action.

Rules:
- Treat all supplied information as canonical.
- Every output item must be supported by explicit information or concrete behavioral evidence in the biography.
- You may infer a stable attribute only when it is strongly supported by the biography.
- Do not use hedging or speculative language such as “probably,” “likely,” “may,” “might,” “could,” “seems,” or “would.”
- Do not describe what the character would think, feel, want, or do in the present situation.
- Do not predict, recommend, justify, or imply an eventual action.
- Include only attributes relevant to the present situation.
- Return an empty string when the biography does not provide sufficient evidence for a field.
- Return exactly one JSON object with no additional prose.

Field definitions:

values_and_beliefs:
Extract enduring principles, priorities, standards, or beliefs explicitly stated or strongly demonstrated in the biography.

A value or belief may be inferred from:
- a repeated pattern of choices;
- a clearly stated principle or opinion;
- a sacrifice repeatedly made for the same priority;
- consistent reactions across multiple events.

Do not infer a value from a single ambiguous action. Do not infer cultural values from demographic identity alone. When culture is relevant, report only a norm or belief that the biography shows this particular character has internalized.

roles_and_commitments:
Extract established social roles, responsibilities, loyalties, promises, or ongoing obligations.

A role or commitment must be supported by:
- an explicitly stated relationship or position;
- a recurring responsibility;
- an established promise or obligation;
- sustained participation in an activity or institution.

capabilities_and_constraints:
Extract established abilities, knowledge, authority, resources, limitations, or recurring practical restrictions.

A capability or constraint must be supported by:
- demonstrated skill or experience;
- a stated physical, financial, social, linguistic, or practical limitation;

Do not convert personality, preferences, temporary emotions, or present-situation logistics into capabilities or constraints.`;

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

Infer them from the biography, including the character’s values, culture, upbringing, experiences, relationships, education, occupation, and broader background. State each attribute directly as a fact.

Use the situation and existing episode context only to determine relevance. Do not use them to invent attributes or justify a particular action.

Return JSON only:

{
  "values_culture_and_background": "",
  "roles_and_commitments": "",
  "capabilities_and_constraints": ""
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
 * Note the field keys: the return template asks for `values_culture_and_background`
 * while the system prompt's field-definitions section heads the same field
 * `values_and_beliefs`. The template wins, because it is the literal JSON
 * contract the model is handed last, it matches the user prompt's own list
 * ("values, culture, upbringing … broader background"), and it is the name every
 * later part's prompt uses. Both texts are otherwise verbatim as supplied.
 */
export function makeAttributesStep(withReflectiveMemories: boolean): FlowStep {
  return {
    key: STEP_ATTRIBUTES,
    label: "Attribute extraction",
    description: `Pulls the person's enduring attributes out of the biography — what they value, what they are committed to, and what they can and cannot do. The situation and episode context only decide which attributes are relevant; they may not create one, and the step is forbidden from reasoning toward an action.${
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

This account will be the primary evidence used by a later model. Preserve enough detail to support psychologically grounded interpretation and decision-making.

The account represents information available before deliberate reflection. Do not include reflective memories or information that becomes accessible only through deliberate reconsideration.

Rules:
- Treat all supplied information as canonical.
- Preserve all supplied information that could materially affect the character’s immediate appraisal or subsequent response.
- Remove biographical information with no plausible bearing on the present situation.
- Combine overlapping information and remove unnecessary repetition without losing meaningful nuance.
- Preserve conflicting, competing, and ambivalent influences.
- Do not favor information supporting one particular response.
- Organize the account into exactly three sections:
  1. RELEVANT CHARACTER BACKGROUND
  2. OBJECTIVE SITUATION
  3. PRE-APPRAISAL STATE AND ACCESSIBLE MEMORIES
- RELEVANT CHARACTER BACKGROUND should integrate relevant biography, values, cultural influences, background, roles, commitments, capabilities, constraints, relationship history, and behavioral tendencies.
- OBJECTIVE SITUATION should contain only externally observable facts about what is currently happening.
- PRE-APPRAISAL STATE AND ACCESSIBLE MEMORIES should contain the character’s current emotional, physical, and cognitive condition, recent influences, and memories directly cued by the present situation.
- Keep objective facts separate from subjective or internal information.
- Do not include reflective memories or reflective context.
- Do not perform the psychological appraisal.
- Do not introduce interpretations of the situation, assumptions about other people, newly activated goals, expected consequences, possible responses, action tendencies, or a final decision.
- Do not invent or embellish facts, events, relationships, memories, motivations, traits, or cultural influences.
- Use third-person prose and state information directly.
- Retain specific names, relationships, relevant timing, prior behavior, practical constraints, and contextual details when they could affect the appraisal.
- Write approximately 500–1000 words when supported by the source material.
- Prefer using fewer than 500 words over repeating, embellishing, interpreting, or inventing information to meet the target.
- Return exactly one JSON object with no additional prose.`;

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

Consolidate the supplied information into a detailed initial-context account.

Include all established information that could materially affect the character’s immediate appraisal and eventual response. Remove unrelated biography and unnecessary repetition while preserving meaningful details, tensions, and competing influences.

Do not include reflective memories, perform the appraisal, or imply the character’s eventual response.

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
 */
export const consolidateStep: FlowStep = {
  key: STEP_CONSOLIDATE,
  label: "Consolidation",
  description:
    "Rewrites the biography, the situation, the pre-reflection episode context, and part 1's attributes into one organised account: relevant background, what is objectively happening, and the state and cued memories the person carries in. Competing and ambivalent influences are kept rather than resolved, and the appraisal itself is left to a later part.",
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
