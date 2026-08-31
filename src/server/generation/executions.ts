import "server-only";

import type { Description } from "@/lib/stage-1";
import type { Scenario, Stage2Config } from "@/lib/stage-2";
import type { Execution } from "@/lib/stage-3";
import { FLOWS, flowByKey } from "@/server/flows";
import { stepSchema, type Flow, type FlowStep } from "@/server/flows/types";
import type { RunContext } from "@/server/generation/runs";
import {
  MAX_CONCURRENT_REQUESTS,
  interleaveByPerson,
  mapWithConcurrency,
} from "@/server/generation/runtime";
import { configuredModel, generateJson } from "@/server/llm/openrouter";
import { listDescriptions } from "@/server/storage/descriptions";
import { listAllExecutions, writeExecution } from "@/server/storage/executions";
import { listAllScenarios, readStage2Config } from "@/server/storage/scenarios";

/**
 * Stage 3 — runs each flow over each Stage 2 scenario.
 *
 * A cell is one (scenario × flow) pair, and a cell is a *pipeline*: its steps
 * run in sequence, each one handed the outputs of the steps before it through
 * `prior`. The record is rewritten after every step, so a flow that dies in its
 * third call keeps the first two, and the next run resumes at the third rather
 * than paying for all of it again.
 *
 * Cells are independent of one another, so they fan out flat — the concurrency
 * limit bounds cells in flight, and each cell's own steps are strictly ordered
 * inside it.
 */

/** One unit of work: this scenario, through this flow. */
type Cell = {
  scenario: Scenario;
  description: Description;
  flow: Flow;
  /** Steps still to run, in flow order. Never empty — empty cells are dropped. */
  pending: FlowStep[];
  /** What is already on disk for this cell, if anything. */
  existing: Execution | null;
};

export type ExecutionResult =
  | { ok: true; profileId: string; scenarioId: string; flowKey: string }
  | {
      ok: false;
      profileId: string;
      scenarioId: string;
      flowKey: string;
      /** Steps that did complete before the failure, and were kept. */
      completed: number;
      error: string;
      /**
       * Set when this cell died on the aborted signal because the run was
       * cancelled. Such items are the cancel rather than findings — the run
       * record already ignores them, and so must the summary.
       */
      aborted?: boolean;
    };

/**
 * Runs a cell's pending steps in order, persisting after each one.
 *
 * Progress is reported per step, not per cell: a step is a model call, and a
 * flow of five steps over ten scenarios is fifty calls however few cells that
 * is. A denominator counted in cells would sit still for minutes at a time.
 */
async function runCell({
  cell,
  model,
  run,
}: {
  cell: Cell;
  model: string;
  run?: RunContext;
}): Promise<ExecutionResult> {
  const { scenario, description, flow } = cell;
  const now = new Date().toISOString();

  let execution: Execution = cell.existing ?? {
    flow_key: flow.key,
    profile_id: scenario.profile_id,
    scenario_id: scenario.id,
    name: scenario.name,
    scenario_title: scenario.title,
    steps: {},
    scenario_generated_at: scenario.generated_at,
    // Non-null because only complete scenarios are made into cells; narrowed
    // where the plan is built.
    scenario_context_generated_at: scenario.context_generated_at ?? "",
    description_generated_at: description.generated_at,
    started_at: now,
    updated_at: now,
  };

  let completed = 0;

  for (const step of cell.pending) {
    // Steps run in sequence, so a cancel has to be checked between them —
    // otherwise the loop keeps queueing calls that only fail once they reach
    // the aborted signal.
    if (run?.signal.aborted) break;

    try {
      const output = await generateJson({
        schema: stepSchema(step),
        system: step.system,
        prompt: step.buildPrompt({
          scenario,
          description,
          // Only the steps already finished, never the ones still to come — a
          // resumed cell must build the same prompt a fresh one would.
          prior: Object.fromEntries(
            Object.entries(execution.steps).map(([key, done]) => [
              key,
              done.output,
            ]),
          ),
        }),
        signal: run?.signal,
      });

      const finishedAt = new Date().toISOString();
      execution = {
        ...execution,
        steps: {
          ...execution.steps,
          [step.key]: { output, generated_at: finishedAt, model },
        },
        updated_at: finishedAt,
      };

      // Written per step rather than once at the end: the call is already paid
      // for, and a later step failing is no reason to throw this away.
      await writeExecution(execution);

      completed++;
      run?.itemDone();
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error);
      // Which step failed is the first thing you want to know: part 1 failing
      // left nothing, part 3 failing left a cell worth resuming.
      const message = `${step.key}: ${raw}`;
      // Only the step that failed is a failure. The steps still queued behind
      // it never got a verdict, and counting them would inflate every error
      // into as many as the flow happens to be long.
      run?.itemFailed({
        id: `${scenario.profile_id} · ${flow.key}`,
        error: message,
      });

      return {
        ok: false,
        profileId: scenario.profile_id,
        scenarioId: scenario.id,
        flowKey: flow.key,
        completed,
        error: message,
        aborted: run?.signal.aborted === true,
      };
    }
  }

  return {
    ok: true,
    profileId: scenario.profile_id,
    scenarioId: scenario.id,
    flowKey: flow.key,
  };
}

/**
 * Checks that every Stage 2 context block a flow's steps read still exists.
 *
 * Declared inputs rather than discovered ones: a step whose block was renamed
 * in `data/stage-2-fields.json` would otherwise run happily on an empty string,
 * and its output would look like a finding about the flow rather than about the
 * missing input.
 */
function assertContextAvailable(flow: Flow, stage2: Stage2Config): void {
  const known = new Set(stage2.context_sections.map((section) => section.key));
  const missing = [
    ...new Set(flow.steps.flatMap((step) => step.requiresContext)),
  ].filter((key) => !known.has(key));

  if (missing.length > 0) {
    throw new Error(
      `Flow "${flow.key}" reads context ${missing
        .map((key) => `"${key}"`)
        .join(", ")}, which data/stage-2-fields.json does not define. ` +
        `Restore those sections, or update the flow's steps in src/server/flows/.`,
    );
  }
}

/**
 * Whether a stored step holds every field the step *now* declares.
 *
 * Presence of the step key is not enough: editing a step's output fields makes
 * what is on disk a different shape than the one later parts read. Exported so
 * the router counts progress by the same rule the planner schedules by —
 * otherwise the page reports a full grid while the runner reports work left.
 */
export function stepIsComplete(
  execution: Execution | null | undefined,
  step: FlowStep,
): boolean {
  const done = execution?.steps[step.key];
  return (
    done !== undefined && step.fields.every((field) => field.key in done.output)
  );
}

/** One scenario's outstanding work, across the selected flows. */
export type ScenarioPlan = {
  scenario: Scenario;
  description: Description;
  /** Flows with something left to do. Flows already finished are dropped. */
  work: { flow: Flow; pending: FlowStep[]; existing: Execution | null }[];
};

export type RunPlan = {
  /** Scenarios with outstanding work, in the order a limit takes them. */
  pending: ScenarioPlan[];
  /** Scenarios a run could touch at all — what a limit is a fraction of. */
  scenarioCount: number;
  /** Scenarios left out because Stage 2's second call never finished. */
  incompleteCount: number;
  /** Scenarios left out because their Stage 1 description is gone. */
  missingBiographyCount: number;
  /** Cells dropped because every step was already done and current. */
  skippedCells: number;
};

/**
 * Works out what a run would do, without doing any of it.
 *
 * Shared by `runFlows` and the router's `plan` query, so the number the button
 * shows is produced by the same code that decides what actually runs. A second
 * implementation on the client would agree at first and drift later.
 *
 * Half-generated scenarios are excluded rather than run: a scenario whose
 * context call never finished is not ground truth yet, and a flow that reads the
 * episode context would be handed five empty blocks.
 *
 * `skipExisting` works per *step*, not per cell. A cell whose steps are all done
 * and current is dropped entirely; a cell missing only its last step plans only
 * that step. That is what makes adding a part to a flow cheap — every existing
 * execution becomes incomplete by exactly one step, not invalid.
 *
 * A step is current when the execution was built from the scenario and the
 * biography as they now stand. Scenario ids are timestamped and never reissued,
 * so the id-reuse trap Stage 1 guards against does not apply here; what does is
 * Stage 2 filling in the context of a scenario already run against, and Stage 1
 * regenerating a description into a different person on the same id.
 */
export async function planFlowRun({
  flowKeys,
  skipExisting,
}: {
  flowKeys: string[];
  skipExisting: boolean;
}): Promise<RunPlan> {
  const [stage2, scenarios, descriptionList, executions] = await Promise.all([
    readStage2Config(),
    listAllScenarios(),
    listDescriptions(),
    listAllExecutions(),
  ]);

  // Rejected rather than ignored: a run that quietly drops a flow reports a grid
  // it never filled, and the missing column looks like a failure instead of a
  // typo in the request.
  const unknown = flowKeys.filter((key) => flowByKey(key) === undefined);
  if (unknown.length > 0) {
    throw new Error(
      `Unknown flow${unknown.length === 1 ? "" : "s"}: ${unknown
        .map((key) => `"${key}"`)
        .join(", ")}. src/server/flows/ defines ${FLOWS.map(
        (flow) => `"${flow.key}"`,
      ).join(", ")}.`,
    );
  }

  const flows = FLOWS.filter((flow) => flowKeys.includes(flow.key));
  for (const flow of flows) assertContextAvailable(flow, stage2);

  const complete = scenarios.filter(
    (scenario) => scenario.context_generated_at !== null,
  );

  const descriptions = new Map(
    descriptionList.map((description) => [description.profile_id, description]),
  );

  // A scenario whose person no longer has a description cannot be run: the
  // biography is the flows' primary input, and a blank one is not a smaller
  // input but a different experiment.
  const runnable = complete.filter((scenario) =>
    descriptions.has(scenario.profile_id),
  );

  const byCell = new Map(
    executions.map((execution) => [
      `${execution.profile_id}/${execution.scenario_id}/${execution.flow_key}`,
      execution,
    ]),
  );

  let skippedCells = 0;
  const pending: ScenarioPlan[] = [];

  for (const scenario of interleaveByPerson(runnable)) {
    const description = descriptions.get(scenario.profile_id)!;
    const work: ScenarioPlan["work"] = [];

    for (const flow of flows) {
      const stored =
        byCell.get(`${scenario.profile_id}/${scenario.id}/${flow.key}`) ?? null;

      // An execution built from a scenario or a biography that has since moved
      // on is not resumable — its finished steps read inputs that no longer
      // exist, so it starts over rather than being extended.
      const current =
        stored !== null &&
        stored.scenario_context_generated_at ===
          scenario.context_generated_at &&
        stored.description_generated_at === description.generated_at;

      const existing = current ? stored : null;

      /**
       * Steps are a pipeline, so re-running one invalidates every step after
       * it: those read an output that no longer exists. Without this, editing
       * part 4 would leave part 5's judgement on disk looking current while the
       * reasoning it was drawn from had been replaced underneath it.
       */
      let rerunFromHere = false;
      const steps = flow.steps.filter((step) => {
        const done =
          skipExisting && !rerunFromHere && stepIsComplete(existing, step);
        if (!done) rerunFromHere = true;
        return !done;
      });

      if (steps.length === 0) {
        skippedCells++;
        continue;
      }

      work.push({
        flow,
        pending: steps,
        // Rerunning without skip-existing rewrites the cell from scratch, so no
        // step of the old record survives to be mistaken for this run's.
        existing: skipExisting ? existing : null,
      });
    }

    // Scenarios with nothing left to do are not in the list the limit counts
    // against: "run 3" should buy three scenarios' worth of work, not three
    // scenarios of which two were already finished.
    if (work.length > 0) pending.push({ scenario, description, work });
  }

  return {
    pending,
    scenarioCount: runnable.length,
    incompleteCount: scenarios.length - complete.length,
    missingBiographyCount: complete.length - runnable.length,
    skippedCells,
  };
}

/** Model calls one scenario's outstanding work would cost. */
export function stepsInPlan(plan: ScenarioPlan): number {
  return plan.work.reduce((total, entry) => total + entry.pending.length, 0);
}

export type RunFlowsSummary = {
  model: string;
  flowKeys: string[];
  /** Scenarios eligible to run against — Stage 2 records that have context. */
  scenarioCount: number;
  /** Scenarios left out because Stage 2's second call never finished. */
  incompleteCount: number;
  /** Scenarios left out because their Stage 1 description is gone. */
  missingBiographyCount: number;
  /** Scenarios with work that this run's limit left for a later run. */
  limitedOut: number;
  /** Cells attempted, and how they ended. A cell is one scenario × one flow. */
  cells: number;
  completed: number;
  failed: number;
  /** Cells skipped because every step was already done and current. */
  skipped: number;
  /** Model calls this run made — the figure that costs money. */
  steps: number;
  errors: { id: string; error: string }[];
};

/**
 * Runs the selected flows over the planned scenarios.
 *
 * `limit` caps how many *scenarios* the run touches, not how many model calls it
 * makes: a scenario is the unit the flows are compared on, so a fraction of one
 * is not a useful thing to buy. Scenarios come off the front of the plan, which
 * is interleaved by person, so a small run spreads across biographies and a
 * larger run later is a superset of it rather than a different sample.
 */
export async function runFlows({
  flowKeys,
  skipExisting,
  limit,
  run,
}: {
  flowKeys: string[];
  skipExisting: boolean;
  /** Maximum scenarios to touch. Omitted means every scenario with work. */
  limit?: number;
  run?: RunContext;
}): Promise<RunFlowsSummary> {
  const model = configuredModel();
  const plan = await planFlowRun({ flowKeys, skipExisting });

  const taken =
    limit === undefined ? plan.pending : plan.pending.slice(0, limit);

  const cells: Cell[] = taken.flatMap(({ scenario, description, work }) =>
    work.map(({ flow, pending, existing }) => ({
      scenario,
      description,
      flow,
      pending,
      existing,
    })),
  );

  const stepCount = cells.reduce(
    (total, cell) => total + cell.pending.length,
    0,
  );
  run?.setTotal(stepCount);

  const results = await mapWithConcurrency(
    cells,
    MAX_CONCURRENT_REQUESTS,
    (cell) => runCell({ cell, model, run }),
  );

  // Cells abandoned to a cancel are neither completed nor failed — they never
  // got a verdict. Counting them as failures made every cancelled run report a
  // wall of failures that never happened.
  const completed = results.filter((result) => result.ok).length;
  const failures = results.filter(
    (result): result is Extract<ExecutionResult, { ok: false }> =>
      !result.ok && !result.aborted,
  );

  return {
    model,
    flowKeys: FLOWS.filter((flow) => flowKeys.includes(flow.key)).map(
      (flow) => flow.key,
    ),
    scenarioCount: plan.scenarioCount,
    incompleteCount: plan.incompleteCount,
    missingBiographyCount: plan.missingBiographyCount,
    limitedOut: plan.pending.length - taken.length,
    cells: cells.length,
    completed,
    failed: failures.length,
    skipped: plan.skippedCells,
    steps: stepCount,
    errors: failures.map((failure) => ({
      id: `${failure.profileId} · ${failure.flowKey}`,
      error: failure.error,
    })),
  };
}
