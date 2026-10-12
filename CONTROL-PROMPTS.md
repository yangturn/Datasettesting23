# Five-call control: prompts and prefix confirmation

Flow key `five_call_control`, defined in `src/server/flows/five-call-control.ts`. Exported as `FIVE_CALL_CONTROL` in `episodes.csv` / `episodes.json`.

## Confirmation that calls 1–3 match SECOND THOUGHT

The control's calls 1–3 are SECOND THOUGHT's calls 1–3 in three senses, each enforced in code rather than by convention.

1. **Same prompts, by object identity.** The control's pipeline is built as `[...FIRST_PERSON_REFLECTIVE_STEPS.slice(0, 3), recallStep, controlDecisionStep]`, where `FIRST_PERSON_REFLECTIVE_STEPS` is the array SECOND THOUGHT (`full_flow_first_person`) itself runs. The three step objects are not copies of the primary arm's attribute extraction, consolidation, and first-person initial appraisal; they are the same objects, so the system prompt, user template, output schema, and context access are byte-identical and cannot drift apart. The flow registry checks at load that the control's first step is the source's own step object on every situation type the control runs on, and refuses to start otherwise.

2. **Same outputs, by copying.** The control does not call the model for calls 1–3. Its planner reads SECOND THOUGHT's execution of the same episode and copies the three step records into the control's execution, each stamped `copied_from: "full_flow_first_person"` with the original `generated_at`, `model`, and token `usage`. A control cell is not run at all until SECOND THOUGHT has produced those three parts for that episode. If SECOND THOUGHT's record for an episode is ever re-run, the copy no longer matches and the control's calls 4 and 5 are re-run on the new prefix. Consequently the control's call 4 receives exactly the consolidated context and initial appraisal that SECOND THOUGHT's call 4 received, down to the character.

3. **Same memory-access timing.** In both arms, reflective memories are visible to call 1 (attribute extraction), withheld from calls 2 and 3, introduced at call 4, and supplied verbatim to call 5 beside the other Stage 2 episode blocks. The control's call 4 reads the same three inputs as SECOND THOUGHT's reappraisal: the consolidated initial context, the initial appraisal (all five fields, laid out under their field keys), and the reflective memories block.

Where the arms differ: call 4's instructions (restate the memories' factual content vs. reconsider the tendency), call 4's output fields (two fields vs. six), and call 5's anchor (`initial_tendency` vs. `revised_action_tendency`). Call 5's citation rules, action-format rules, and bans on invention are carried over unchanged from SECOND THOUGHT's decision prompt. Time-sensitive episodes are excluded from the control, since SECOND THOUGHT skips its reappraisal there.

Model and settings are shared: the single model named by `OPENROUTER_MODEL` (`deepseek/deepseek-v4-pro-0813` as configured), reasoning effort `low`, temperature 0, JSON-object response format, one corrective retry on schema failure. Token usage per call is recorded on every step run from this version of the code onward.

Placeholders in the user templates below are written `{{...}}` and name the Stage 2 block or the earlier part's field inserted there. `{{appraisal}}` stands for call 3's five fields, each rendered as `field_key:` followed by its text, separated by blank lines; `{{recall}}` likewise for call 4's two fields. `{{episode_context}}` stands for the Stage 2 blocks (relationship profiles, established tendencies, current state, immediate memories, reflective memories) each under its own heading in triple quotes, exactly as SECOND THOUGHT's decision prompt receives them.

---

## Call 4 — Memory recollection (step key `recall`)

Output fields: `initial_tendency`, `recalled_memories`.

### System prompt

```
You generate a character’s private, first-person recollection of reflective memories for a behavioral-prediction benchmark.

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
* Copy the supplied `initial_action_tendency` verbatim into `initial_tendency`. Do not summarize, reinterpret, strengthen, soften, or otherwise alter it.
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
Copy the character’s `initial_action_tendency` from the initial appraisal verbatim. Preserve its first-person wording and exact meaning.

recalled_memories:
Restate the factual content of the supplied reflective memories in the first person, one memory after another, in the order they are supplied. Keep each to the facts the memory states. Do not interpret, evaluate, connect them to the present situation, or draw any conclusion from them.
```

### User template

```
Consolidated initial context:

"""
{{consolidate.initial_context}}
"""

Initial appraisal:

"""
{{appraisal}}
"""

Reflective memories:

"""
{{reflective_memories}}
"""

Generate the character’s private, first-person recollection of the reflective memories.

Restate their factual content only. Preserve the initial appraisal as the character’s genuine first reaction and copy `initial_action_tendency` verbatim into `initial_tendency`.

Write the recollection as the character’s own private recall using “I,” “me,” and “my.” Do not describe the character from an external perspective or use model-planning language.

Do not relate the memories to the present situation, reconsider the initial tendency, compare responses, invent information, or perform the final action.

Return JSON only:

{
"initial_tendency": "",
"recalled_memories": ""
}
```

---

## Call 5 — Final decision (step key `decision`)

Output fields: `action`, `explanation`. Same key and fields as every other flow's decision, so the judge scores it identically.

### System prompt

```
You generate and explain a character’s final behavioral response for a behavioral-prediction benchmark.

You are given the character’s relevant context, first-person initial appraisal, and first-person recollection of reflective memories. Determine what the character actually does or says and explain why this response is most plausible for this particular character.

The initial appraisal and the recollection represent the character’s private subjective cognition. The character has recalled the reflective memories but has not reconsidered the initial action tendency. Convert that initial tendency into a single externally observable response without exposing unspoken thoughts as behavior or dialogue.

Rules:

* Treat all supplied information as canonical.
* Select the single most plausible immediate response for this character in the current situation.
* Use only the canonical episode context, the consolidated initial context, the initial appraisal, and the recollection.
* Ground the response in the character’s background, personality and response style, relationships, behavioral tendencies, current state, immediate memories, reflective memories, and initial appraisal.
* Preserve the initial appraisal as the character’s genuine first reaction.
* Treat `initial_tendency` as an unchanged record of the initial provisional impulse and as the proximal basis for the final response.
* Do not reconsider, revise, strengthen, soften, reverse, or replace the initial tendency, and do not perform a deliberation the character did not perform.
* Keep the final action consistent with the supplied `initial_tendency`, including any hesitation, qualification, delay, or compromise it already contains.
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

Do not invent information, contradict the supplied appraisal, expose private thoughts as observable behavior, claim that the character reconsidered or that the memories changed the action, or treat an interpretation, emotion, concern, or inclination generated in the appraisal as evidence in its own right.
```

### User template

```
Consolidated initial context:

"""
{{consolidate.initial_context}}
"""

{{episode_context}}

Initial appraisal:

"""
{{appraisal}}
"""

Recalled reflective memories:

"""
{{recall}}
"""

Generate the single most plausible immediate action the character takes from the initial action tendency and explain why.

The initial appraisal and the recollection are written in the character’s first-person internal voice. Produce the externally observable action and causal explanation in third person. First-person language may appear only inside dialogue spoken by the character.

Use `initial_tendency` as the character’s most recent provisional inclination. The recalled memories were brought to mind and not acted on: do not reconsider, revise, or qualify the initial tendency in their light, and do not redo the appraisal.

The action must contain only externally observable behavior. The explanation must cite the specific facts from the canonical episode context and the consolidated initial context that produced that behavior, naming each in the terms the context uses, must cite the time the situation allowed for a response and describe the recollection within that time rather than claiming a pause the situation does not give, and must state in one sentence that the initial tendency was carried into the action unchanged.

Do not invent information, list alternative actions, or continue the scene beyond the character’s immediate response.

Return JSON only:

{
"action": "",
"explanation": ""
}
```

---

## How calls 4 and 5 relate to SECOND THOUGHT's

Both prompts are adaptations of SECOND THOUGHT's first-person reappraisal and reflective decision prompts, changed only where the control design requires:

- Call 4 keeps the same inputs, voice rules, canonicity and non-invention rules, the verbatim copy of `initial_action_tendency`, and the ban on performing the action. It removes the comparison of responses, the consequence and constraint weighing, the `change_from_initial` classification, `reconsidered_interpretation`, `motivational_conflict`, and `revised_action_tendency`, and replaces them with a factual restatement of every memory.
- Call 5 keeps the same action rules, the same definition of evidence, the same citation requirements (including the requirement to cite every reflective memory that bears on the action, those that pulled the other way included), the same time-window rule, and the same length guidance. It anchors on `initial_tendency` instead of `revised_action_tendency`, replaces the one-sentence `RETAINED/STRENGTHENED/SOFTENED/REVERSED` statement with a one-sentence statement that the tendency was carried unchanged, and forbids adding or removing qualifications the initial tendency does not contain.
