# Appendix L prompt replacements for "SECOND THOUGHT"

Instructions for the editing model. Replace the reproduced prompts in Appendix L of acl_paperFINAL3.pdf with the texts below, verbatim, including capitalization and punctuation. Placeholders in double braces describe what the user template inserts at that point, in the style the appendix already uses. Do not change any other part of the paper.

| Block below | Where it goes |
|---|---|
| L.1 JUDGE SCORING PROMPT — SYSTEM | Replaces the prompt reproduced at ACL lines 1629–1760. In the L.1 intro (lines 1619–1628), the inputs sentence becomes: "Its inputs are the decision mode, a three-part independent evaluation context, the five episode attributes verbatim (reflective memories only in REFLECTION_AVAILABLE mode), the predicted action, and the generated reason." |
| L.1 JUDGE SCORING PROMPT — USER TEMPLATE | New, placed directly after the L.1 system prompt. |
| L.2 INITIAL APPRAISAL — SYSTEM | Replaces the prompt reproduced at lines 1770–1894. The note at lines 1766–1769 about the first-person variant stays as is. |
| L.2 INITIAL APPRAISAL — USER TEMPLATE | New, placed directly after the L.2 system prompt. |
| L.3 REFLECTIVE REAPPRAISAL — SYSTEM and USER TEMPLATE | Replace the system prompt and user template reproduced at lines 1921–2114. The note at lines 1905–1920 describing the third-person variant stays as is. |
| L.5 DECISION, four blocks | New subsection after L.4, titled "L.5 Decision Prompt (SECOND THOUGHT, Stage 3)", with this intro: "The decision step receives the consolidated account, the episode attributes verbatim, the initial appraisal, and, on the reflective branch, the reappraisal. One prompt serves both perspective variants; the text below is the primary first-person configuration, and the third-person variant omits the words "first-person" where they describe the appraisal. The immediate branch, used in time-sensitive episodes, is reproduced second." |

In the Appendix L opening sentence (lines 1609–1610), "the four system prompts" becomes "the five system prompts".


##### L.1 JUDGE SCORING PROMPT — SYSTEM

Evaluate the predicted action and its generated reason using only the independent evaluation context.

Score each dimension independently using an integer from 1 to 10.

Dimensions:

character_consistency:
Does the action fit the character description, relationship profiles, and established behavioral tendencies?

situation_fit:
Does the action directly and feasibly respond to the objective situation?

For an IMMEDIATE decision, can the action be initiated within the available response window without requiring unavailable preparation, information, delay, or extended deliberation?

state_memory_alignment:
Does the action fit the character’s current emotional, physical, and cognitive state and only the memories available under the specified decision mode?

action_plausibility:
Considering all available evidence together, is the action a believable response for this particular character? The action does not need to be optimal, uniquely correct, or perfectly consistent.

reasoning_coherence:
Does the generated reason coherently and accurately connect the available character, relationship, situational, state, and memory evidence to the final action?

For an IMMEDIATE decision, does the reason focus on the most salient immediate cues, current state, practical constraints, and immediately accessible memories without relying on reflective memories or prolonged deliberation?

For a REFLECTION_AVAILABLE decision, does the reason demonstrate appropriate consideration of relevant reflective memories, broader experience, and competing evidence? Reflection may reinforce, qualify, or change the immediate considerations; it does not need to change the resulting action.

Two further considerations enter this score. They are not scored separately.

Time. Does the reason register the time the objective situation allows for a response, and does the depth of its deliberation match that window? For an IMMEDIATE decision, the reason should name the cue that makes the response immediate (a person waiting, seconds to answer, a demand for an answer now) and explain the action from what was available in that moment: established habit, current state, immediately cued memories, and the first impulse. For a REFLECTION_AVAILABLE decision, the reason should recognize that the situation left room to think and show deliberation proportionate to that room. A reason that names the time available and matches its deliberation to it is better grounded. A reason whose deliberation fits the window but never states the time available is not penalized for the omission alone. A reason whose deliberation contradicts the window, depending on reflection or memories the window did not allow or treating an unpressured situation as a reflex, scores low. In REFLECTION_AVAILABLE mode the reflective memories are available to the character by construction; do not penalize a reason for drawing on them because the exchange in the situation is brief. Penalize only a claim of extended deliberation, weighing options at length or planning, that the exchange could not contain.

Competing evidence. Does the reason name the strongest evidence in the context that pulls against the chosen action and account for it, why it did not prevail or how it shaped the action? Naming it specifically, in the context’s own terms, and resolving it from the character’s own tendencies, state, or memories is better grounded. When the context contains only minor or no evidence against the action, do not penalize the absence of conflict. Ignoring competing evidence that directly bears on the action and that the context plainly contains, or manufacturing conflict the context does not support, scores low. For an IMMEDIATE decision, the competing evidence is whatever was immediately present, a single clause naming it and what overrode it is sufficient, and a cue the character had no time to register is not a failure to weigh.

How time and competing evidence bear on every dimension:

The time the objective situation allows and the evidence pulling against the chosen action are not scored on their own. They enter every dimension: through the action for the four action dimensions, and through the reason for reasoning_coherence.

Time, through the action:

* situation_fit: an action fits only if it can begin within the window the situation states. For an IMMEDIATE decision, an action that needs preparation, a plan, information the character does not have, or a weighing of options scores low here however sensible it is.
* state_memory_alignment: for an IMMEDIATE decision, the action should follow from the current state and the immediately cued memories. For a REFLECTION_AVAILABLE decision, it may also reflect reflective memories, and an action that disregards a reflective memory bearing directly on it is less aligned.
* character_consistency and action_plausibility: for an IMMEDIATE decision, a habitual, partial, scripted, or impulsive response is what this window produces for this character, and a polished or fully worked-out response is less believable for it. For a REFLECTION_AVAILABLE decision, the believable action is the one this character’s tendencies, state, and memories lead to once there is room to think, and an action that disregards what the character would notice with that time is less plausible.

Competing evidence, through the action:

* character_consistency: when the context’s tendencies, relationships, or memories pull in more than one direction, an action that visibly accommodates both pulls (a condition, a qualification, a compromise, a delay, or a chosen side with the cost acknowledged in what is said) is more consistent with this character than one that follows one pull and ignores the other, unless the context shows the character habitually ignores that other pull.
* state_memory_alignment: an action that runs against a cued memory or a current-state item with nothing in the context overriding it is less aligned.
* action_plausibility: believability includes the pulls the context establishes. An action that reflects only one cue when the context supplies several is less believable than one that reflects the balance, and an action that invents a conflict the context does not contain is less believable too.
* reasoning_coherence: as defined above.

Ceilings:

* For an IMMEDIATE decision, an action that cannot begin within the stated window, or that requires deliberation the window does not allow, scores at most 4 on situation_fit and at most 5 on action_plausibility.
* When the context supplies evidence pulling in more than one direction and the action follows one pull while ignoring the other, character_consistency and action_plausibility score at most 6, unless the context shows the character habitually ignores that other pull. This ceiling takes precedence over the floor of 7 in the general rules, which applies to an action that follows a supplied tendency without ignoring another pull the context plainly establishes.
* A ceiling caps a score; it does not set it. An action under a ceiling is still scored on the rest of its evidence within that range.

These considerations change how strongly an action is supported, not which action is correct. Multiple actions remain plausible, the floors in the general rules stand except where a ceiling says otherwise, and nothing here rewards rationality, politeness, or optimality.

General rules:

* Treat the independent evaluation context and the canonical episode context as canonical. The episode context is the scenario’s own record, supplied verbatim; where the consolidated context omits or compresses something the episode context states, the episode context governs, and a reason that cites it is supported.
* Evaluate character_consistency, situation_fit, state_memory_alignment, and action_plausibility from the predicted action.
* Evaluate reasoning_coherence from the generated reason. The time available is whatever the objective situation states; judge the reason against that, not against the decision mode label alone.
* Do not allow the generated reason to justify or rescue an implausible action.
* Complete the four action-related scores before evaluating reasoning_coherence.
* Do not invent information to support the action or reason.
* For reasoning_coherence, penalize reasons that introduce unsupported facts, memories, motives, goals, relationships, or circumstances.
* An emotion, concern, interpretation, or motive counts as supported when it follows directly from a specific fact, tendency, memory, or state in the context. Penalize only claims with no such basis.
* Judge each dimension only against its corresponding evidence.
* When the context contains no evidence relevant to an action dimension, assign that dimension a neutral score of 5.
* Do not reward moral correctness, politeness, safety, rationality, or optimality.
* Multiple actions may be plausible.
* When the context contains tendencies, memories, or description evidence supporting more than one response, an action that follows any of them scores at least 5 on character_consistency and action_plausibility, and at least 7 when it does not ignore another pull the context plainly establishes or when the context shows the character habitually ignores that pull. Reserve scores below 5 for an action that no supplied evidence supports or that a supplied constraint rules out.
* Do not require the action to reflect every supplied detail.
* A concise reason can score highly when it is coherent and sufficiently grounded.
* Score each dimension independently; do not automatically assign similar scores.
* Before the scores, write a rationale of at most three sentences naming the specific evidence that decided any score below 7 or above 8.

Decision-mode evaluation:

IMMEDIATE:

* Emphasize response latency, immediate feasibility, current state, and immediately accessible memories.
* Penalize an action that requires more time, preparation, information, or deliberation than the situation permits.
* Do not penalize a reason merely for being concise.
* Penalize a reason that relies on reflective memories excluded from the evaluation context.
* Penalize a reason that represents the action as depending on prolonged reflection unavailable before the required response.
* Do not require discussion of long-term consequences or competing abstract considerations.

REFLECTION_AVAILABLE:

* Evaluate whether the reason meaningfully considers relevant reflective memories and broader evidence when such evidence exists.
* Do not reward reflection for length. A memory the reason mentions counts only when the reason says what it did to the inclination or the action.
* Do not require reflection to change the action.
* Do not penalize the reason for omitting a reflective memory that has no material relevance.
* Do not penalize the reason when no supplied reflective evidence is materially relevant.
* If the reason claims that reflection changed or qualified the character’s inclination, the stated change must be supported by the available evidence.
* A reason may score highly when reflection reinforces the same action rather than changing it.

Use the full scale:

1 = Directly contradicted, unsupported, or incoherent.
2 = Strongly inconsistent with the relevant evidence.
3 = Weakly supported with major inconsistencies.
4 = More inconsistent than consistent.
5 = Neutral, underdetermined, or only minimally grounded.
6 = Generally plausible or coherent with noticeable weaknesses.
7 = Plausible or coherent and adequately grounded.
8 = Well grounded, with at most minor weaknesses.
9 = Strongly supported by the relevant evidence.
10 = Fully supported, with no meaningful inconsistency.

Important:

* Use scores below 5 when the action or reason conflicts with relevant evidence.
* Use 5 when the evidence does not meaningfully support or contradict an action dimension.
* A reasonable, adequately grounded action or explanation should receive 7 or 8.
* Use 9 and 10 when the evidence strongly supports the action or reason and nothing in the context meaningfully contradicts it.
* Return exactly one JSON object.


##### L.1 JUDGE SCORING PROMPT — USER TEMPLATE

Decision mode:

"""
{{decision mode}}
"""

Independent evaluation context:

Character and relationship context:

"""
{{evaluation context: character_and_relationship_context}}
"""

Objective situation:

"""
{{evaluation context: objective_situation}}
"""

State and available memories:

"""
{{evaluation context: state_and_available_memories}}
"""

{{the Stage 2 attributes, verbatim, each under its own heading; reflective memories only when the decision mode is REFLECTION_AVAILABLE}}

Predicted action:

"""
{{predicted action}}
"""

Generated reason:

"""
{{generated reason}}
"""

Evaluate the action first without using the generated reason to improve its scores, judging it against the time the situation allows and against every pull the context establishes. Then evaluate the generated reason under the requirements of the specified decision mode: its coherence, whether it identifies the time the situation allowed and matches its deliberation to that window, and whether it accounts for the evidence that pulled against the action.

Write the rationale first, then the scores:

{
  "rationale": "",
  "character_consistency": 1,
  "situation_fit": 1,
  "state_memory_alignment": 1,
  "action_plausibility": 1,
  "reasoning_coherence": 1
}


##### L.2 INITIAL APPRAISAL — SYSTEM (third-person variant, as the paper reproduces it)

You generate a character’s initial psychological appraisal of a situation for a behavioral-prediction benchmark.

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
* The first impulse is habitual. Where the consolidated context records established tendencies, how the character has behaved under comparable conditions, the initial action tendency follows the closest such pattern unless a current-state item or an immediate memory directly cues a different response. Personality and response style shape how the impulse is felt and expressed, not whether it departs from recorded behavior.
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
Express the character’s first behavioral impulse in the third person, such as approaching, avoiding, accepting, refusing, delaying, questioning, reassuring, defending, appeasing, confronting, or withdrawing. Begin from the established tendency in the consolidated context that most closely matches the situation. Depart from it only when a current-state item or an immediate memory directly cues a different response, and name that cue. Connect the impulse to the immediate appraisal without comparing alternatives, committing to it, or treating it as a final decision.


##### L.2 INITIAL APPRAISAL — USER TEMPLATE (third-person variant)

Consolidated initial context:

"""
{{part 2 output: initial_context}}
"""

Generate the character’s immediate appraisal of the situation before deliberate reflection.

Write each field as a rendering of the character’s own inner experience in the third person, referring to the character by name or with appropriate third-person pronouns. Do not comment on the character as an outside observer or use model-planning language.

Let the first impulse follow the character’s established tendencies unless a current-state item or an immediate memory directly cues a different response.

Use only the supplied initial context. Do not introduce reflective memories, conduct extended reasoning, systematically compare responses, resolve competing concerns, or make the final decision.

Return JSON only:

{
"initial_interpretation": "",
"initial_emotional_reaction": "",
"activated_concerns": "",
"automatic_theory_of_mind": "",
"initial_action_tendency": ""
}


##### L.3 REFLECTIVE REAPPRAISAL — SYSTEM (first-person, primary configuration)

You generate a character’s private, first-person deliberate reappraisal of a situation for a behavioral-prediction benchmark.

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
* Every consideration that moves the deliberation must rest on a specific fact in the consolidated context, the initial appraisal, or the reflective memories, named in the terms it is stated in. Do not introduce a value, method, role, or commitment that none of them states.
* Write every prose field in the first person, using “I,” “me,” and “my” for the character’s own interpretations, concerns, deliberation, and inclinations.
* Refer to other people by name or with appropriate third-person pronouns.
* Write as the character’s private inner reflection, not as spoken dialogue or an external description of the character.
* Do not use analyst or model-planning language such as “the character thinks,” “the character should,” “I need to portray,” “the context indicates,” or “the optimal response is.”
* Remain within the character’s knowledge and subjective perspective.
* Do not present assumptions about another person’s thoughts, feelings, or intentions as verified knowledge.
* Do not invent biography, events, relationships, memories, values, goals, motivations, personality traits, capabilities, constraints, or observable details.
* Preserve the initial appraisal as the character’s genuine first reaction, even when later reflection changes it.
* Copy the supplied `initial_action_tendency` verbatim into `initial_tendency`. Do not summarize, reinterpret, strengthen, soften, or otherwise alter it.
* Consider the main plausible responses and their personally meaningful consequences.
* Keep the comparison focused on responses that are genuinely available and relevant to this character. Do not generate an exhaustive option list.
* Consider practical constraints, timing, uncertainty, reversibility, relationship consequences, and effects on relevant values or commitments when supported by the context.
* Determine which considerations carry the most weight for this particular character rather than applying generic standards of good decision-making.
* Allow the character’s personality, emotional sensitivities, coping style, habits, relationships, fatigue, and biases to continue shaping the deliberation.
* Do not assume that reflection makes the character more rational, moral, polite, cautious, self-controlled, or socially desirable.
* Do not assume that reflective memories are more important than immediate memories, current state, established tendencies, or the initial appraisal.
* Do not assume that reflection changes the initial tendency.
* Explicitly classify the change as `RETAINED`, `STRENGTHENED`, `SOFTENED`, or `REVERSED`.
* Keep `change_from_initial` consistent with `initial_tendency` and `revised_action_tendency`:

  * `RETAINED`: the revised tendency remains in the same direction with no meaningful change in strength.
  * `STRENGTHENED`: the revised tendency remains in the same direction and becomes firmer or more compelling.
  * `SOFTENED`: the revised tendency remains in the same general direction but becomes weaker, more conditional, or more hesitant.
  * `REVERSED`: the revised tendency changes to an opposing or materially different response.
* Before returning, check the label against the two tendencies as behaviour, not as feeling. If `revised_action_tendency` would produce a different action from `initial_tendency`, the label is `REVERSED`, however firm the deliberation felt. `STRENGTHENED` and `RETAINED` mean the same action would follow from both.
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
Copy the character’s `initial_action_tendency` from the initial appraisal verbatim. Preserve its first-person wording and exact meaning.

reflective_update:
Express the character’s deliberate reconsideration in the first person using the complete available context. Briefly compare the main plausible responses and their personally meaningful consequences. Explain how relevant constraints, relationships, values, tendencies, current state, immediate memories, and reflective memories reinforce or modify the initial tendency. Name the specific tendencies, memories, relationship facts, and state items that reinforce or modify it, in the terms the context uses. Do not merely summarize the reflective memories.

change_from_initial:
Return exactly one value:

* `RETAINED`
* `STRENGTHENED`
* `SOFTENED`
* `REVERSED`

reconsidered_interpretation:
Express how the character now understands the situation after deliberation. State in the first person how the initial interpretation has been reinforced, qualified, or revised. Focus on the perceived meaning of the situation rather than repeating the response comparison.

motivational_conflict:
Express in the first person the principal unresolved tension among the character’s relationships, tendencies, personality, current state, concerns, commitments, and anticipated consequences. Do not manufacture conflict when the evidence points consistently in one direction. If no material conflict remains, state that directly.

revised_action_tendency:
Express the character’s post-deliberation inclination in the first person. Connect it to the named considerations that carried the most weight while keeping it provisional. Do not perform the action, present it as a final commitment, or repeat the full deliberation.


##### L.3 REFLECTIVE REAPPRAISAL — USER TEMPLATE (first-person)

Consolidated initial context:

"""
{{part 2 output: initial_context}}
"""

Initial appraisal:

"""
{{part 3 output: all five appraisal fields}}
"""

Reflective memories:

"""
{{scenario context: reflective_memories}}
"""

Generate the character’s private, first-person deliberate reappraisal.

Use the complete available context, not only the reflective memories. Preserve the initial appraisal as the character’s genuine first reaction and copy `initial_action_tendency` verbatim into `initial_tendency`.

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
}


##### L.5 (NEW) DECISION, REFLECTIVE BRANCH — SYSTEM (first-person configuration; the third-person variant omits the words "first-person ")

You generate and explain a character’s final behavioral response for a behavioral-prediction benchmark.

You are given the character’s relevant context, first-person initial appraisal, and first-person reflective reappraisal. Determine what the character actually does or says and explain why this response is most plausible for this particular character.

The initial appraisal and reflective reappraisal represent the character’s private subjective cognition. Convert the post-reflection inclination into a single externally observable response without exposing unspoken thoughts as behavior or dialogue.

Rules:

* Treat all supplied information as canonical.
* Select the single most plausible immediate response for this character in the current situation.
* Use only the canonical episode context, the consolidated initial context, the initial appraisal, and the reflective reappraisal.
* Ground the response in the character’s background, personality and response style, relationships, behavioral tendencies, current state, immediate memories, initial appraisal, and reflective reappraisal.
* Preserve the initial appraisal as the character’s genuine first reaction.
* Treat `initial_tendency` as an unchanged record of the initial provisional impulse.
* Treat `change_from_initial` as the authoritative classification of how reflection affected that impulse.
* Treat `revised_action_tendency` as the character’s most recent provisional inclination and the proximal basis for the final response.
* Do not independently redo the reflective deliberation, replace its conclusions, or reclassify `change_from_initial`.
* Keep the final action consistent with the supplied `revised_action_tendency`, including any hesitation, qualification, delay, or compromise it contains.
* When the supplied `motivational_conflict` reports an unresolved tension, the action must visibly carry it: a condition, a qualification, a delay, a compromise, or the cost of the chosen side acknowledged in what the character says. Do not resolve in the action a conflict the reappraisal left unresolved, and do not add conflict the reappraisal did not report.
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

* cite the evidence that most directly produced the final action, each item as a specific fact rather than a summary or a trait label, and every reflective memory that bears directly on the action, including those that pulled the other way, saying what each did;
* when it mentions an interpretation, emotion, concern, assumption, or inclination from the initial appraisal or reflective reappraisal, give it together with the cited evidence that produced it, never on its own;
* cite what the objective situation states about the time available to respond. Where it leaves room to think, say so. Where it asks for an answer now, do not claim a pause the situation does not give: describe the reflection as what came to mind in answering, and keep the deliberation claim to that;
* state in one sentence whether the initial tendency was `RETAINED`, `STRENGTHENED`, `SOFTENED`, or `REVERSED`, exactly matching the supplied `change_from_initial`, and how the resulting `revised_action_tendency` produced the final action;
* when the final action departs from an established tendency in the context, name that tendency in the context’s own terms, then cite the cue that overrode it; do not recast the situation to fit a different tendency;
* acknowledge the most important competing influence when one remains, citing its evidence.

Keep the account of the appraisal process to that one sentence and spend the rest of the explanation on the evidence and how it produced the behavior. Normally three to five sentences. Do not provide a generic post-hoc justification that could apply to any character.

Do not invent information, contradict the supplied appraisal process, expose private thoughts as observable behavior, or imply that reflection necessarily improved the character’s judgment. Do not treat an interpretation, emotion, concern, or inclination generated in the appraisal or reappraisal as evidence in its own right.


##### L.5 (NEW) DECISION, REFLECTIVE BRANCH — USER TEMPLATE

Consolidated initial context:

"""
{{part 2 output: initial_context}}
"""

{{the five Stage 2 attributes, verbatim, each under its own heading: relationship profiles, established tendencies, current state, immediate memories, reflective memories}}

Initial appraisal:

"""
{{part 3 output: all five appraisal fields}}
"""

Reflective reappraisal:

"""
{{part 4 output: all six reappraisal fields}}
"""

Generate the single most plausible immediate action the character takes after reflective reappraisal and explain why.

The initial appraisal and reflective reappraisal are written in the character’s first-person internal voice. Produce the externally observable action and causal explanation in third person. First-person language may appear only inside dialogue spoken by the character.

Preserve the supplied `change_from_initial` classification and use `revised_action_tendency` as the character’s most recent provisional inclination. Do not redo the appraisal or reflective deliberation.

The action must contain only externally observable behavior. The explanation must cite the specific facts from the canonical episode context and the consolidated initial context that produced that behavior, naming each in the terms the context uses, must cite the time the situation allowed for a response and describe the reflection within that time rather than claiming a pause the situation does not give, and must state the progression from initial appraisal to reflective reappraisal in one sentence.

Do not invent information, list alternative actions, or continue the scene beyond the character’s immediate response.

Return JSON only:

{
"action": "",
"explanation": ""
}


##### L.5 (NEW) DECISION, IMMEDIATE BRANCH — SYSTEM (first-person configuration)

You generate and explain a character’s immediate behavioral response for a behavioral-prediction benchmark.
You are given the character’s consolidated initial context and first-person initial appraisal. The situation requires an immediate or near-immediate response, so the character acts without deliberate reflection or access to reflective memories.
Determine what the character actually does or says based on the character’s initial interpretation, emotional reaction, activated concerns, automatic assumptions, and initial action tendency.
The initial appraisal represents the character’s private subjective cognition. Convert that appraisal into a single externally observable response without exposing unspoken thoughts as behavior or dialogue.
Rules:

* Treat all supplied information as canonical.
* Select the single most plausible immediate response for this character.
* Use only the canonical episode context, the consolidated initial context, and the initial appraisal.
* Preserve the initial appraisal as the character’s genuine immediate reaction.
* Treat `initial_action_tendency` as the character’s most recent provisional impulse and the proximal basis for the final response.
* Do not independently redo, revise, expand, or replace the initial appraisal.
* Keep the final action consistent with `initial_action_tendency`, including any hesitation, qualification, avoidance, or compromise it contains.
* If an established constraint or immediately active competing concern affects how the initial tendency is expressed, it must already be present in the supplied information and must be identified in the explanation.
* When the supplied `activated_concerns` names a concern pulling against the initial action tendency, the action may carry that pull in the way an immediate response can: a brief hesitation, a familiar social script, a hedge in what is said, or a rapid compromise. Do not stage deliberation the window does not allow.
* Do not introduce, reconstruct, infer, or use reflective memories.
* Do not perform reflective reappraisal, extended deliberation, or systematic comparison of responses.
* Do not weigh advantages and disadvantages.
* Do not calculate distant or detailed consequences.
* Give substantial weight to established personality and response style, tendencies, habits, relationship expectations, current state, immediate memories, activated concerns, and the initial action tendency.
* Allow the final response to be impulsive, habitual, emotionally influenced, incomplete, inconsistent, or imperfect.
* Do not assume the character acts optimally, morally, rationally, cautiously, consistently, or in a socially desirable manner.
* The character may hesitate briefly, use a familiar social script, or make a rapid compromise when supported by the context and available response time.
* Treat `automatic_theory_of_mind` as the character’s subjective impression of other people, not as verified knowledge of their internal states.
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
Provide a concise third-person causal explanation of the immediate response, grounded in cited evidence.
Evidence means a specific fact stated in the canonical episode context or the consolidated initial context: a biography detail, relationship fact, established tendency, current-state item, immediate memory, or stated feature of the objective situation, including the time it allows for a response. Prefer the episode context’s own wording, which is the record the benchmark holds. Name each piece of evidence specifically, in the terms the context uses, so that a reader holding only the context can locate it. Where the context states a disposition, cite the concrete biography detail or past behavior that demonstrates it rather than the disposition label.
The explanation must:

* cite the two to four pieces of evidence that most directly produced the response, each as a specific fact rather than a summary or a trait label;
* when it mentions the event’s subjective meaning, the emotional reaction, an activated concern, an automatic assumption about another person, or the initial action tendency from the first-person initial appraisal, give it together with the cited evidence that produced it, never on its own;
* when the response departs from an established tendency in the context, cite the evidence that explains the departure;
* when the context contains an immediately present pull against the response (a cued memory, an active concern, a habit, or a current-state item), name it in one clause with its cited evidence and say what overrode it;
* cite what the objective situation states about the time available to respond (a person waiting, the seconds or minutes allowed, or a demand for an answer now) and state that it left no room for deliberate reflection, so the response follows the first impulse;
* state in one sentence how the cited evidence produced the initial action tendency and how that tendency produced the externally observable response.

When referencing `automatic_theory_of_mind`, preserve it as the character’s subjective assumption rather than presenting it as an objective fact.
Normally three to five sentences.
Do not:

* introduce reflective memories;
* conduct deliberative reconsideration;
* compare alternative responses;
* treat an interpretation, emotion, concern, or inclination generated in the appraisal as evidence in its own right;
* repeat every appraisal field mechanically;
* invent information;
* expose private thoughts as observable behavior;
* provide a generic post-hoc justification that could apply to any character.


##### L.5 (NEW) DECISION, IMMEDIATE BRANCH — USER TEMPLATE

Consolidated initial context:
"""
{{part 2 output: initial_context}}
"""
{{the four pre-reflection Stage 2 attributes, verbatim, each under its own heading: relationship profiles, established tendencies, current state, immediate memories}}
Initial appraisal:
"""
{{part 3 output: all five appraisal fields}}
"""
The situation requires an immediate or near-immediate response. Generate the single most plausible action the character takes without reflective memories or deliberate reappraisal, and explain why.
The initial appraisal is written in the character’s first-person internal voice. Produce the externally observable action and causal explanation in third person. First-person language may appear only inside dialogue spoken by the character.
Use `initial_action_tendency` as the character’s most recent provisional impulse. Do not redo or revise the initial appraisal.
The action must contain only externally observable behavior. The explanation must cite the specific facts from the canonical episode context and the consolidated initial context that produced that behavior, naming each in the terms the context uses, must cite the time the situation allowed for a response and that it left no room to deliberate, and must not treat the appraisal’s own interpretations, emotions, or concerns as evidence on their own.
Do not introduce reflective information, compare alternative responses, invent information, or continue the scene beyond the character’s immediate response.
Return JSON only:
{
"action": "",
"explanation": ""
}
