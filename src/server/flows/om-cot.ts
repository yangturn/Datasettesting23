import "server-only";

import {
  ALL_CONTEXT_KEYS,
  availableMemories,
  contextBlock,
  STEP_DECISION,
} from "@/server/flows/shared";
import type { Flow, FlowStep, StepInput } from "@/server/flows/types";

/**
 * OM-COT — observation-and-memory chain of thought, in one call.
 *
 * Structurally this is Direct Zero Shot: one step, the same canonical material,
 * the same two output fields. What differs is the instruction. Direct Zero Shot
 * forbids staged reasoning outright; this flow prescribes three stages —
 * analyse the observation, find the historical evidence that bears on it,
 * predict from the two together — and still asks for only the action and a
 * concise account of the observation–memory connection.
 *
 * So the pair isolates a different variable than the staged flows do. Full Flow
 * and Her Dual Layered Thinking put their stages on the record as separate calls
 * with their own outputs; here the stages happen inside one call and only the
 * conclusion is persisted. That makes this flow the middle term of the
 * comparison: prescribed reasoning, unprescribed reasoning, and reasoning
 * externalised into a pipeline.
 *
 * A consequence worth knowing when reading results: nothing downstream can check
 * whether the three stages actually happened. The record shows the conclusion,
 * not the work. See the note on the step below.
 *
 * One step, keyed `decision` and producing `action` and `explanation`, so
 * `decision.action` means the same thing here as in every other flow.
 */

const OM_COT_SYSTEM = `You predict a character’s next behavior using observation-and-memory-based reasoning.

Reason in three stages:

1. Observation analysis:
Analyze the objective situation, the people involved, what response is required, and any timing or practical constraints.

2. Memory analysis:
Identify the supplied relationships, behavioral tendencies, biographical experiences, and available memories that are most relevant to the present observation. Connect specific historical evidence to specific features of the situation.

3. Behavior prediction:
Use the observation and relevant historical evidence to predict one concrete action.

Rules:
- Treat all supplied information as canonical.
- Do not invent biography, relationships, behavior, memories, motives, or constraints.
- Focus on specific evidence rather than demographic or personality stereotypes.
- Do not simply summarize the entire character description.
- Use only evidence relevant to the present situation.
- Predict exactly one observable action.
- The action must directly and feasibly respond to the situation.
- Do not present alternative actions.
- Do not perform an initial-appraisal/reappraisal sequence.
- The explanation should concisely describe the relevant observation–memory connection.
- Refer to the character in the third person.
- Return exactly one JSON object with no additional prose.

{
  "action": "",
  "explanation": ""
}`;

function buildOmCotPrompt(input: StepInput): string {
  return `Character description:

"""
${input.description.description}
"""

Current situation:

"""
${input.scenario.situation}
"""

Relationship profiles:

"""
${contextBlock(input, "relationship_profiles")}
"""

Established tendencies:

"""
${contextBlock(input, "tendencies")}
"""

Current state:

"""
${contextBlock(input, "current_state")}
"""

Available memories:

"""
${availableMemories(input)}
"""

Analyze the current observation, connect it to the most relevant supplied historical evidence, and predict the character’s next action.

Return JSON only:

{
  "action": "",
  "explanation": ""
}`;
}

/**
 * The flow's only part, and therefore its output.
 *
 * Two fields rather than four: the supplied prompt names three reasoning stages
 * but asks for exactly one JSON object holding `action` and `explanation`, so
 * the observation and memory analyses stay internal to the call. Adding keys for
 * them would externalise the stages and make this a different flow — closer to
 * the staged pipelines it is meant to be contrasted with.
 *
 * `requiresContext` names all five Stage 2 blocks: four are read directly, and
 * reflective memories are read for every situation type but TIME_SENSITIVE.
 */
const omCotStep: FlowStep = {
  key: STEP_DECISION,
  label: "Observation–memory prediction",
  description:
    "Predicts one concrete, observable action in a single call, working through three prescribed stages inside that call: what the situation objectively presents, which supplied relationships, tendencies, and memories bear on it, and the action the two together imply. Only the action and the observation–memory connection behind it are returned; appraisal/reappraisal sequences and alternative actions are forbidden.",
  requiresContext: ALL_CONTEXT_KEYS,
  fields: [
    { key: "action", label: "Action", render: "prose" },
    { key: "explanation", label: "Explanation", render: "prose" },
  ],
  system: OM_COT_SYSTEM,
  buildPrompt: buildOmCotPrompt,
};

export const omCotFlow: Flow = {
  key: "om_cot",
  label: "OM-COT",
  description:
    "One call with prescribed reasoning: analyse the observation, connect it to the most relevant supplied history, then predict a single concrete action. The three stages happen inside the call — only the action and its observation–memory connection are recorded. Reflective memories are withheld when the situation is time-sensitive.",
  steps: [omCotStep],
  outcome: {
    stepKey: STEP_DECISION,
    fieldKey: "action",
    reasonKey: "explanation",
  },
};
