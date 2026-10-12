# Necessary prose edits to "SECOND THOUGHT"

Instructions for the editing model. The reported results were produced with the prompts reproduced in Appendix L (see PAPER-PROMPTS.md). The four items below are the places where the main text or another appendix states something the prompts contradict. Each names a location by section and by the ACL line numbers in the right margin of acl_paperFINAL3.pdf, quotes the current text, and gives the replacement. Apply only these. Do not change the results tables. The overall score is the unweighted mean of the five dimensions, as the paper already says; leave every sentence that says so.

---

## 1. Section 6, Decision generation, lines 388–390

Current text:

> Decision generation. The final stage converts the revised tendency into one observable action and a causal explanation without redoing the deliberation.

Replace with:

> Decision generation. The final stage converts the revised tendency into one observable action and a causal explanation without redoing the deliberation. It receives the episode attributes verbatim alongside the consolidated account, all five on the reflective branch and the four pre-reflection attributes on the immediate branch, so that the explanation cites evidence in the attributes' own wording (Appendix L.5).

## 2. Section 8.1, Shared Evaluation Context, lines 434–440

Current text:

> An evaluation context is constructed once per episode from the person description and episode information, without seeing any predictions, and every method is assessed against it; reflective memories are included only when reflection is available, so the evaluator does not expect predictions to use withheld information.

Replace with:

> An evaluation context is constructed once per episode from the person description and episode information, without seeing any predictions, and every method is assessed against it together with the five episode attributes verbatim; reflective memories are included in both only when reflection is available, so the evaluator does not expect predictions to use withheld information.

## 3. Section 8.3, Judging Procedure, lines 457–464

Current text:

> The judge is not told which method generated a prediction, assesses the action before the explanation so that a persuasive justification cannot rescue a weak decision, and is instructed not to reward morality, politeness, rationality, or length; a score of 5 means insufficient evidence either way, and a merely reasonable action should receive 5–6.

Replace with:

> The judge is not told which method generated a prediction, writes a rationale of at most three sentences before its scores, assesses the action before the explanation so that a persuasive justification cannot rescue a weak decision, and is instructed not to reward morality, politeness, rationality, or reflection for its length; a score of 5 means insufficient evidence either way, and a reasonable, adequately grounded action or explanation receives 7–8.

## 4. Appendix K, lines 1531–1532

Current text:

> The judge returns scores only, so the interpretation of why outputs differ is ours.

Replace with:

> The judge writes a rationale before its scores; where the discussion below attributes a score to a reason, it follows the judge's own rationale for that cell.

---

## Not required

These are omissions or disclosures rather than contradictions. Nothing in the paper is false without them.

- Figure 1: an arrow from the episode attributes to the decision step.
- Section 6 and Appendix G: the habit-first rule in the initial appraisal, and the reappraisal's label check and citing rule. Both are visible in Appendix L.2 and L.3.
- Section 7 and Limitations: that the baseline prompts do not ask for time or competing-evidence reasoning, and that the rubric carries no instruction against rewarding an elaborate reason while SECOND THOUGHT writes the longest reasons.
- Appendix E: "against that context" could read "against that context and the attributes verbatim".
- Section 8.5: only if the annotators judged outputs from before the final prompts, say so.
