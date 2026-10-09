import "server-only";

import type { Description } from "@/lib/stage-1";
import { situationTypeSchema, type Scenario } from "@/lib/stage-2";
import type { Execution } from "@/lib/stage-3";
import {
  decisionModeFor,
  evaluationContextContentSchema,
  evaluationJudgementSchema,
  overallScore,
  SCORE_DIMENSION_SET,
  SCORE_SCALE_MAX,
  type DecisionMode,
  type Evaluation,
  type EvaluationContext,
} from "@/lib/stage-4";
import { FLOWS } from "@/server/flows";
import type { Flow } from "@/server/flows/types";
import type { RunContext } from "@/server/generation/runs";
import { interleaveByPerson } from "@/server/generation/runtime";
import { configuredModel, generateJson } from "@/server/llm/openrouter";
import { listDescriptions } from "@/server/storage/descriptions";
import {
  listAllEvaluationContexts,
  writeEvaluationContext,
} from "@/server/storage/evaluation-contexts";
import {
  listAllEvaluations,
  writeEvaluation,
} from "@/server/storage/evaluations";
import { listExecutionsForScenario } from "@/server/storage/executions";
import { listAllScenarios } from "@/server/storage/scenarios";

/**
 * Stage 4 — evaluation, as one serial pipeline per scenario.
 *
 * For each scenario: build the independent evaluation context (part 1), then
 * score each flow's predicted action against it (part 2). The context comes
 * first because part 2 reads it, and a scenario whose context could not be built
 * has nothing to score against.
 *
 * Unlike Stage 3, calls here run strictly one after another — no fan-out, no
 * concurrency. Scoring is the measurement, and the measurement is worth taking
 * slowly: it keeps the ordering deterministic, keeps the provider from batching
 * judgements of different scenarios together, and makes a partial run a clean
 * prefix of a whole one rather than a scattering of finished cells.
 *
 * Every call is persisted the moment it lands, so a run stopped anywhere keeps
 * what it has already paid for and the next one resumes from there.
 */

// ---------------------------------------------------------------------------
// Part 1 — the independent evaluation context
// ---------------------------------------------------------------------------

const CONTEXT_SYSTEM = `You consolidate canonical character and episode information into an independent evaluation context for a behavioral-prediction benchmark.

The available source fields are:

- character description;
- objective situation;
- relationship profiles;
- established tendencies;
- current state;
- immediate memories;
- reflective memories, when reflection is available.

Rewrite the permitted information into a detailed, coherent representation that a later evaluator can use to judge the plausibility of a predicted action.

This is only a consolidation step. Do not perform psychological appraisal or predict an action.

Rules:
- Use only the supplied source fields.
- Treat all supplied information as canonical.
- Do not use information from the decision-making flow being evaluated.
- Preserve every supplied detail that could materially affect the character’s response.
- Remove only information that has no plausible relevance to the situation.
- Combine overlapping information and remove unnecessary repetition.
- Preserve conflicting, competing, or ambivalent evidence.
- Do not favor evidence supporting one particular response.
- Do not infer or add values, beliefs, cultural influences, roles, commitments, goals, preferences, capabilities, constraints, motives, or personality traits that are not directly stated in the supplied fields.
- Do not invent or embellish events, relationships, memories, facts, or practical circumstances.
- Do not interpret what the situation means to the character.
- Do not infer what another person thinks, feels, wants, or intends.
- Do not generate active concerns, anticipated consequences, possible actions, action tendencies, or decisions.
- Keep objective facts separate from character background and internal context.
- Use coherent third-person paragraphs.
- Write approximately 500–1000 words when the source material supports that length.
- Use fewer words rather than repeating, interpreting, or inventing information to reach the target.

Memory-access rule:
- If decision_mode is IMMEDIATE, include immediate memories and exclude reflective memories.
- If decision_mode is REFLECTION_AVAILABLE, include both immediate and reflective memories.
- Never reconstruct or allude to an excluded reflective memory.

Return exactly one JSON object with no additional prose.`;

/** A Stage 2 context block, or an empty line when the block came back blank. */
function contextBlock(scenario: Scenario, key: string): string {
  return scenario.context[key]?.trim() ?? "";
}

export function buildContextPrompt({
  description,
  scenario,
  mode,
}: {
  description: Description;
  scenario: Scenario;
  mode: DecisionMode;
}): string {
  // Appended only in REFLECTION_AVAILABLE mode. The block is absent rather
  // than empty: an empty "Reflective memories" heading tells the model that
  // reflective material exists and was withheld, which is itself information
  // the immediate context is not supposed to carry.
  const reflective =
    mode === "REFLECTION_AVAILABLE"
      ? `

Reflective memories:

"""
${contextBlock(scenario, "reflective_memories")}
"""`
      : "";

  return `Decision mode:

"""
${mode}
"""

Character description:

"""
${description.description}
"""

Objective situation:

"""
${scenario.situation}
"""

Relationship profiles:

"""
${contextBlock(scenario, "relationship_profiles")}
"""

Established tendencies:

"""
${contextBlock(scenario, "tendencies")}
"""

Current state:

"""
${contextBlock(scenario, "current_state")}
"""

Immediate memories:

"""
${contextBlock(scenario, "immediate_memories")}
"""${reflective}

Consolidate exactly the permitted supplied information into a neutral independent evaluation context.

Do not perform psychological appraisal, infer missing character information, describe possible responses, or predict an action.

Return JSON only:

{
  "character_and_relationship_context": "",
  "objective_situation": "",
  "state_and_available_memories": ""
}`;
}

// ---------------------------------------------------------------------------
// Part 2 — scoring a predicted action against that context
// ---------------------------------------------------------------------------

const SCORE_SYSTEM = `Evaluate the predicted action and its generated reason using only the independent evaluation context.

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

time_consideration:
Does the reason identify the time the situation allows for a response, and does the depth of its deliberation match that window?

For an IMMEDIATE decision, does the reason name the cue that makes the response immediate (a person waiting, seconds to answer, a demand for an answer now) and explain the action from what was available in that moment: established habit, current state, immediately cued memories, and the first impulse?

For a REFLECTION_AVAILABLE decision, does the reason recognize that the situation left room to think (a deadline that allows it, or the absence of pressure) and show deliberation proportionate to that room, weighing the relevant reflective evidence and competing considerations before the action?

Calibration: the depth of deliberation is what is scored; naming the time cue is how a reason shows it. A reason that names the time available and matches its deliberation to it scores 8 to 10. A reason whose deliberation fits the window but that never states the time available scores 6 or 7. Scores of 1 to 3 are for a reason whose deliberation contradicts the window: one that depends on reflection or memories the window did not allow, or that treats an unpressured situation as a reflex.

evidence_weighing:
Does the reason identify the strongest evidence in the context that pulls against the chosen action and account for it: why it did not prevail, or how it shaped the form the action took?

Calibration: a reason that names the competing evidence specifically, in the context’s own terms, and resolves it from the character’s own tendencies, state, or memories scores 8 to 10. A reason that does not mention competing evidence when the context contains only minor or indirect evidence against the action, or none, scores 6 or 7; do not penalize the absence of conflict. Scores of 1 to 3 are for a reason that ignores competing evidence that directly bears on the action and that the context plainly contains, or that manufactures conflict the context does not support.

For an IMMEDIATE decision, the competing evidence is whatever was immediately present: a cued memory, an active concern, a habit, or a current-state item pulling the other way. A single clause that names it and says what overrode it is sufficient. Do not require consideration of long-term consequences or abstract alternatives, and do not penalize brevity. A competing cue the character had no time to register is not a failure to weigh; score 7 when the reason’s evidence is one-directional and immediate.

For a REFLECTION_AVAILABLE decision, expect the reason to weigh the competing evidence in proportion to the time available, including relevant reflective memories, and to say why it did not prevail or how it qualified the action.

General rules:

* Treat the independent evaluation context and the canonical episode context as canonical. The episode context is the scenario’s own record, supplied verbatim; where the consolidated context omits or compresses something the episode context states, the episode context governs, and a reason that cites it is supported.
* Evaluate character_consistency, situation_fit, state_memory_alignment, and action_plausibility from the predicted action.
* Evaluate reasoning_coherence, time_consideration, and evidence_weighing from the generated reason. For time_consideration, the time available is whatever the objective situation states; judge the reason against that, not against the decision mode label alone.
* Do not allow the generated reason to justify or rescue an implausible action.
* Complete the four action-related scores before evaluating reasoning_coherence, time_consideration, and evidence_weighing.
* Do not invent information to support the action or reason.
* For reasoning_coherence, penalize reasons that introduce unsupported facts, memories, motives, goals, relationships, or circumstances.
* An emotion, concern, interpretation, or motive counts as supported when it follows directly from a specific fact, tendency, memory, or state in the context. Penalize only claims with no such basis.
* Judge each dimension only against its corresponding evidence.
* When the context contains no evidence relevant to an action dimension, assign that dimension a neutral score of 5.
* Do not reward moral correctness, politeness, safety, rationality, or optimality.
* Multiple actions may be plausible.
* When the context contains tendencies, memories, or description evidence supporting more than one response, an action that follows any of them scores at least 7 on character_consistency and action_plausibility. Reserve scores below 5 for an action that no supplied evidence supports or that a supplied constraint rules out.
* Do not require the action to reflect every supplied detail.
* A concise reason can score highly when it is coherent and sufficiently grounded.
* Do not reward a reason merely for being detailed, persuasive, or psychologically elaborate.
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
* Do not reward reflection merely for being lengthy or mentioning every supplied memory.
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
* Return exactly one JSON object.`;

export function buildScorePrompt({
  context,
  scenario,
  action,
  reason,
  mode,
}: {
  context: EvaluationContext;
  scenario: Scenario;
  action: string;
  reason: string;
  mode: DecisionMode;
}): string {
  // The Stage 2 episode blocks go to the judge verbatim as well as through the
  // consolidated context. Part 1 is told to preserve every material detail and
  // does not always: one rebuilt context dropped the tendencies block whole,
  // and the judge then scored every reason that cited those tendencies as
  // inventing them. The blocks are canonical and contain nothing from any
  // flow, so handing them over directly costs the judge none of its
  // independence. Reflective memories follow the same mode gate as part 1.
  const reflectiveBlock =
    mode === "REFLECTION_AVAILABLE"
      ? `

Reflective memories:

"""
${contextBlock(scenario, "reflective_memories")}
"""`
      : "";
  const episode = `Canonical episode context, verbatim from the scenario record:

Relationship profiles:

"""
${contextBlock(scenario, "relationship_profiles")}
"""

Established tendencies:

"""
${contextBlock(scenario, "tendencies")}
"""

Current state:

"""
${contextBlock(scenario, "current_state")}
"""

Immediate memories:

"""
${contextBlock(scenario, "immediate_memories")}
"""${reflectiveBlock}`;

  // The reason now reaches the judge, where it used to be withheld: it is
  // scored in its own right by reasoning_coherence. The old guarantee — that a
  // fluent explanation cannot talk up a poor action — is no longer structural,
  // so the prompt carries it instead, both in the rules and in the instruction
  // to score the action before reading the reason.
  //
  // The mode is stated because reasoning_coherence asks different things of an
  // immediate reason and a reflective one, and the consolidated context does
  // not say which memories were withheld from the flow being judged.
  return `Decision mode:

"""
${mode}
"""

Independent evaluation context:

Character and relationship context:

"""
${context.character_and_relationship_context}
"""

Objective situation:

"""
${context.objective_situation}
"""

State and available memories:

"""
${context.state_and_available_memories}
"""

${episode}

Predicted action:

"""
${action}
"""

Generated reason:

"""
${reason}
"""

Evaluate the action first without using the generated reason to improve its scores. Then evaluate the generated reason under the requirements of the specified decision mode: its coherence, whether it identifies the time the situation allowed and matches its deliberation to that window, and whether it accounts for the evidence that pulled against the action.

Write the rationale first, then the scores:

{
  "rationale": "",
  "character_consistency": 1,
  "situation_fit": 1,
  "state_memory_alignment": 1,
  "action_plausibility": 1,
  "reasoning_coherence": 1,
  "time_consideration": 1,
  "evidence_weighing": 1
}`;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** A flow's prediction, ready to be scored. */
type Scorable = {
  flow: Flow;
  action: string;
  /**
   * The flow's own account of how it reached that action, empty when the flow
   * names no reason field or left it blank. Blank is passed through rather than
   * treated as missing work: the action is still judgeable, and a decision that
   * came with no explanation is honestly incoherent by the judge's own scale.
   */
  reason: string;
  actionGeneratedAt: string;
};

/** One scenario's outstanding Stage 4 work, in the order it will run. */
export type EvaluationWork = {
  scenario: Scenario;
  description: Description;
  mode: DecisionMode;
  /** Null when a current context already exists — then only scoring is left. */
  existingContext: EvaluationContext | null;
  needsContext: boolean;
  /** Flows whose predicted action still needs scoring. */
  pendingScores: Scorable[];
};

export type EvaluationPlan = {
  /** Scenarios with outstanding work, in the order a limit takes them. */
  pending: EvaluationWork[];
  scenarioCount: number;
  /** Scenarios left out because Stage 2's second call never finished. */
  incompleteCount: number;
  /** Scenarios left out because their Stage 1 description is gone. */
  missingDescriptionCount: number;
  /** Contexts already current, so a skip-existing run leaves them alone. */
  contextsDone: number;
  /** (scenario × flow) scores already current. */
  scoresDone: number;
  /**
   * Flow predictions that do not exist yet — Stage 3 has not reached the
   * outcome step for that cell, so there is nothing to score.
   */
  unpredicted: number;
};

/** Model calls this scenario's outstanding work would cost. */
export function callsInWork(work: EvaluationWork): number {
  return (work.needsContext ? 1 : 0) + work.pendingScores.length;
}

/**
 * Works out what a run would do, without doing any of it. Shared by the runner
 * and the router's `plan` query, so the number the button shows is produced by
 * the code that decides what actually runs.
 *
 * A context is current when it was built from the scenario and the description
 * as they now stand, and under the decision mode the situation implies today. A
 * score is current when it was made against that same context and against the
 * action the flow currently holds.
 */
export async function planEvaluations({
  skipExisting,
}: {
  skipExisting: boolean;
}): Promise<EvaluationPlan> {
  const [scenarios, descriptionList, contexts, evaluations] = await Promise.all([
    listAllScenarios(),
    listDescriptions(),
    listAllEvaluationContexts(),
    listAllEvaluations(),
  ]);

  const descriptions = new Map(
    descriptionList.map((description) => [description.profile_id, description]),
  );

  const complete = scenarios.filter(
    (scenario) => scenario.context_generated_at !== null,
  );
  const runnable = complete.filter((scenario) =>
    descriptions.has(scenario.profile_id),
  );

  const contextByScenario = new Map(
    contexts.map((context) => [
      `${context.profile_id}/${context.scenario_id}`,
      context,
    ]),
  );
  const evaluationByCell = new Map(
    evaluations.map((evaluation) => [
      `${evaluation.profile_id}/${evaluation.scenario_id}/${evaluation.flow_key}`,
      evaluation,
    ]),
  );

  let contextsDone = 0;
  let scoresDone = 0;
  let unpredicted = 0;
  const pending: EvaluationWork[] = [];

  for (const scenario of interleaveByPerson(runnable)) {
    const description = descriptions.get(scenario.profile_id)!;
    const mode = decisionModeFor(
      situationTypeSchema.parse(scenario.situation_type),
    );

    const storedContext =
      contextByScenario.get(`${scenario.profile_id}/${scenario.id}`) ?? null;
    const contextCurrent =
      storedContext !== null &&
      storedContext.scenario_context_generated_at ===
        scenario.context_generated_at &&
      storedContext.description_generated_at === description.generated_at &&
      storedContext.decision_mode === mode;

    const needsContext = !(skipExisting && contextCurrent);
    if (!needsContext) contextsDone++;

    // The predictions available to score, read per scenario rather than by
    // walking every execution on disk.
    const executions = await listExecutionsForScenario(
      scenario.profile_id,
      scenario.id,
    );
    const byFlow = new Map(
      executions.map((execution) => [execution.flow_key, execution]),
    );

    const pendingScores: Scorable[] = [];

    for (const flow of FLOWS) {
      if (!flow.outcome) continue;

      const execution: Execution | undefined = byFlow.get(flow.key);
      const step = execution?.steps[flow.outcome.stepKey];
      const action = step?.output[flow.outcome.fieldKey]?.trim();
      const reasonKey = flow.outcome.reasonKey;
      const reason =
        (reasonKey === undefined
          ? undefined
          : step?.output[reasonKey]?.trim()) ?? "";

      // Stage 3 has not produced this flow's answer yet, so there is nothing to
      // judge. Counted rather than silently ignored — the page should say why
      // the grid is short.
      if (!step || !action) {
        unpredicted++;
        continue;
      }

      const stored = evaluationByCell.get(
        `${scenario.profile_id}/${scenario.id}/${flow.key}`,
      );
      const scoreCurrent =
        stored !== undefined &&
        // A score from an older scale, or against an older set of dimensions,
        // is a different judgement wearing the same digit, so it is redone
        // rather than kept.
        stored.score_scale === SCORE_SCALE_MAX &&
        stored.dimension_set === SCORE_DIMENSION_SET &&
        contextCurrent &&
        storedContext !== null &&
        stored.context_generated_at === storedContext.generated_at &&
        stored.action_generated_at === step.generated_at;

      if (skipExisting && scoreCurrent) {
        scoresDone++;
        continue;
      }

      pendingScores.push({
        flow,
        action,
        reason,
        actionGeneratedAt: step.generated_at,
      });
    }

    if (needsContext || pendingScores.length > 0) {
      pending.push({
        scenario,
        description,
        mode,
        existingContext: contextCurrent ? storedContext : null,
        needsContext,
        pendingScores,
      });
    }
  }

  return {
    pending,
    scenarioCount: runnable.length,
    incompleteCount: scenarios.length - complete.length,
    missingDescriptionCount: complete.length - runnable.length,
    contextsDone,
    scoresDone,
    unpredicted,
  };
}

// ---------------------------------------------------------------------------
// Running
// ---------------------------------------------------------------------------

export type EvaluationRunSummary = {
  model: string;
  scenarioCount: number;
  incompleteCount: number;
  missingDescriptionCount: number;
  unpredicted: number;
  /** Scenarios with work that this run's limit left for a later run. */
  limitedOut: number;
  /** Model calls this run intended, and how they ended. */
  calls: number;
  contextsBuilt: number;
  scored: number;
  failed: number;
  /** How the contexts built split by memory access. */
  immediate: number;
  reflective: number;
  errors: { id: string; error: string }[];
};

/**
 * Runs Stage 4 over the planned scenarios, one call at a time.
 *
 * `limit` caps how many *scenarios* the run touches, not how many calls it
 * makes — a scenario is the unit the flows are compared on, and half of one is
 * not a useful thing to buy.
 */
export async function runEvaluations({
  skipExisting,
  limit,
  run,
}: {
  skipExisting: boolean;
  limit?: number;
  run?: RunContext;
}): Promise<EvaluationRunSummary> {
  const model = configuredModel();
  const plan = await planEvaluations({ skipExisting });

  const taken =
    limit === undefined ? plan.pending : plan.pending.slice(0, limit);
  const calls = taken.reduce((total, work) => total + callsInWork(work), 0);
  run?.setTotal(calls);

  let contextsBuilt = 0;
  let scored = 0;
  let immediate = 0;
  let reflective = 0;
  const errors: { id: string; error: string }[] = [];

  // Strictly serial, scenario by scenario and call by call. See the module
  // comment: Stage 4 is the measurement, and it is taken one at a time.
  for (const work of taken) {
    if (run?.signal.aborted) break;

    const { scenario, description, mode } = work;
    let context = work.existingContext;

    if (work.needsContext) {
      try {
        const content = await generateJson({
          schema: evaluationContextContentSchema,
          system: CONTEXT_SYSTEM,
          prompt: buildContextPrompt({ description, scenario, mode }),
          signal: run?.signal,
          temperature: 0,
        });

        context = {
          ...content,
          profile_id: scenario.profile_id,
          scenario_id: scenario.id,
          name: scenario.name,
          scenario_title: scenario.title,
          situation_type: scenario.situation_type,
          decision_mode: mode,
          reflective_memories_included: mode === "REFLECTION_AVAILABLE",
          scenario_generated_at: scenario.generated_at,
          // Non-null because only complete scenarios are planned.
          scenario_context_generated_at: scenario.context_generated_at ?? "",
          description_generated_at: description.generated_at,
          generated_at: new Date().toISOString(),
          model,
        };

        await writeEvaluationContext(context);

        contextsBuilt++;
        if (mode === "IMMEDIATE") immediate++;
        else reflective++;
        run?.itemDone();
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const message = `context: ${raw}`;
        run?.itemFailed({ id: scenario.profile_id, error: message });
        if (run?.signal.aborted !== true) {
          errors.push({ id: scenario.profile_id, error: message });
        }
        // Without a context there is nothing to score against, so this
        // scenario's judgements are abandoned rather than run blind. They are
        // not counted as failures — they never got a verdict.
        continue;
      }
    }

    if (!context) continue;

    for (const {
      flow,
      action,
      reason,
      actionGeneratedAt,
    } of work.pendingScores) {
      if (run?.signal.aborted) break;

      try {
        // The rationale is split off here: `scores` stays a record of numbers
        // for the averages, and the rationale is stored beside it as text.
        const { rationale, ...scores } = await generateJson({
          schema: evaluationJudgementSchema,
          system: SCORE_SYSTEM,
          prompt: buildScorePrompt({ context, scenario, action, reason, mode }),
          signal: run?.signal,
          temperature: 0,
        });

        const evaluation: Evaluation = {
          profile_id: scenario.profile_id,
          scenario_id: scenario.id,
          flow_key: flow.key,
          name: scenario.name,
          scenario_title: scenario.title,
          scores,
          overall_score: overallScore(scores),
          score_scale: SCORE_SCALE_MAX,
          dimension_set: SCORE_DIMENSION_SET,
          action,
          reason,
          rationale,
          decision_mode: mode,
          context_generated_at: context.generated_at,
          action_generated_at: actionGeneratedAt,
          generated_at: new Date().toISOString(),
          model,
        };

        await writeEvaluation(evaluation);

        scored++;
        run?.itemDone();
      } catch (error) {
        const raw = error instanceof Error ? error.message : String(error);
        const message = `${flow.key}: ${raw}`;
        run?.itemFailed({ id: scenario.profile_id, error: message });
        if (run?.signal.aborted !== true) {
          errors.push({ id: scenario.profile_id, error: message });
        }
      }
    }
  }

  return {
    model,
    scenarioCount: plan.scenarioCount,
    incompleteCount: plan.incompleteCount,
    missingDescriptionCount: plan.missingDescriptionCount,
    unpredicted: plan.unpredicted,
    limitedOut: plan.pending.length - taken.length,
    calls,
    contextsBuilt,
    scored,
    failed: errors.length,
    immediate,
    reflective,
    errors,
  };
}
