import "server-only";

import type { Description } from "@/lib/stage-1";
import { situationTypeSchema, type Scenario } from "@/lib/stage-2";
import type { Execution } from "@/lib/stage-3";
import {
  decisionModeFor,
  evaluationContextContentSchema,
  evaluationScoresSchema,
  overallScore,
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
- If decision_mode is REFLECTIVE, include both immediate and reflective memories.
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
  // Appended only in REFLECTIVE mode. The block is absent rather than empty:
  // an empty "Reflective memories" heading tells the model that reflective
  // material exists and was withheld, which is itself information the immediate
  // context is not supposed to carry.
  const reflective =
    mode === "REFLECTIVE"
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

Tendencies:

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

Consolidate exactly the supplied information into a neutral evaluation context.

Do not perform psychological appraisal, infer missing character information, or predict an action.

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

const SCORE_SYSTEM = `Evaluate the predicted action using only the independent evaluation context.

Score each dimension independently using an integer from 1 to 10.

Dimensions:

character_consistency:
Does the action fit the character description, relationship profiles, and established tendencies?

situation_fit:
Does the action directly and feasibly respond to the objective situation, including its timing and practical constraints?

state_memory_alignment:
Does the action fit the character’s current state and the memories available in the evaluation context?

Rules:
- Treat the evaluation context as canonical.
- Evaluate only the predicted action.
- Do not use the generated reason to justify the action.
- Do not invent information to support the prediction.
- Do not reward moral correctness, politeness, safety, or optimality.
- Multiple actions may be plausible.
- Return scores only, without explanations or additional fields.

Use the full scale:

1 = Directly contradicts the established evidence.
2 = Strongly inconsistent with the character or situation.
3 = Weakly supported with major problems.
4 = More inconsistent than consistent.
5 = Borderline plausible but poorly grounded.
6 = Generally plausible with noticeable weaknesses.
7 = Clearly plausible and adequately grounded.
8 = Strongly plausible and well grounded.
9 = Highly character-specific and strongly supported.
10 = Exceptionally well supported with no meaningful inconsistency.

Important:
- Do not default to scores between 7 and 9.
- Use scores below 5 when the action conflicts with important evidence.
- A merely reasonable action should receive 5 or 6, not 8 or 9.
- Reserve 9 and 10 for actions that are unusually well matched to this particular character.
- Score each dimension independently; do not automatically give similar scores across all dimensions.
- Return scores only.

Return exactly one JSON object.`;

export function buildScorePrompt({
  context,
  action,
}: {
  context: EvaluationContext;
  action: string;
}): string {
  // Only the action reaches the judge — never the flow's own explanation. The
  // prompt forbids using the generated reason to justify the action, and the
  // surest way to honour that is not to send it.
  return `Independent evaluation context:

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

Predicted action:
"""
${action}
"""

Evaluate the action. Return scores only.

{
  "character_consistency": 1,
  "situation_fit": 1,
  "state_memory_alignment": 1
}`;
}

// ---------------------------------------------------------------------------
// Planning
// ---------------------------------------------------------------------------

/** A flow's prediction, ready to be scored. */
type Scorable = {
  flow: Flow;
  action: string;
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
        // A score from an older scale is a different judgement wearing the same
        // digit, so it is redone rather than kept.
        stored.score_scale === SCORE_SCALE_MAX &&
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
        });

        context = {
          ...content,
          profile_id: scenario.profile_id,
          scenario_id: scenario.id,
          name: scenario.name,
          scenario_title: scenario.title,
          situation_type: scenario.situation_type,
          decision_mode: mode,
          reflective_memories_included: mode === "REFLECTIVE",
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

    for (const { flow, action, actionGeneratedAt } of work.pendingScores) {
      if (run?.signal.aborted) break;

      try {
        const scores = await generateJson({
          schema: evaluationScoresSchema,
          system: SCORE_SYSTEM,
          prompt: buildScorePrompt({ context, action }),
          signal: run?.signal,
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
          action,
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
