import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { paginate, paginationInputSchema } from "@/lib/pagination";
import { FLOWS, flowMeta } from "@/server/flows";
import { flowStepsFor } from "@/server/flows/types";
import {
  planFlowRun,
  runFlows,
  stepIsComplete,
  stepsInPlan,
} from "@/server/generation/executions";
import { activeRunForStage, startRun } from "@/server/generation/runs";
import { MAX_CONCURRENT_REQUESTS } from "@/server/generation/runtime";
import { configuredModel } from "@/server/llm/openrouter";
import { listDescriptions } from "@/server/storage/descriptions";
import { listExecutionsForScenario } from "@/server/storage/executions";
import { listAllScenarios } from "@/server/storage/scenarios";
import { createTRPCRouter, publicProcedure } from "@/server/trpc";

/**
 * Refuses a second run for a stage while one is in flight. Two runs writing the
 * same records would interleave, and both would report counts that were never
 * true of the files on disk.
 */
function assertNoActiveRun(stage: Parameters<typeof activeRunForStage>[0]) {
  const active = activeRunForStage(stage);
  if (active) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `A ${stage} run is already going (${active.done} of ${active.total ?? "?"} done). Cancel it first.`,
    });
  }
}

/**
 * Scenarios a flow can actually run against: Stage 2 finished writing them, and
 * the person still has the Stage 1 description the flows read as the biography.
 */
async function runnableScenarios() {
  const [scenarios, descriptions] = await Promise.all([
    listAllScenarios(),
    listDescriptions(),
  ]);

  const known = new Set(
    descriptions.map((description) => description.profile_id),
  );
  const byProfile = new Map(
    descriptions.map((description) => [description.profile_id, description]),
  );

  const complete = scenarios.filter(
    (scenario) => scenario.context_generated_at !== null,
  );
  const runnable = complete.filter((scenario) => known.has(scenario.profile_id));

  return {
    runnable,
    byProfile,
    incompleteCount: scenarios.length - complete.length,
    missingBiographyCount: complete.length - runnable.length,
  };
}

/** Stage 3 — every Stage 2 scenario run through each flow being compared. */
export const executionsRouter = createTRPCRouter({
  /**
   * The flows as defined in `src/server/flows/`, so the page describes what will
   * actually run rather than a hardcoded copy of it.
   */
  config: publicProcedure.query(() => ({
    maxConcurrent: MAX_CONCURRENT_REQUESTS,
    flows: flowMeta(),
  })),

  /**
   * One page of scenarios, each with every flow's execution so far — the grid is
   * read by row, since comparing the flows on one situation is the only reason
   * to look at it.
   */
  list: publicProcedure
    .input(paginationInputSchema)
    .query(async ({ input }) => {
      const { runnable, byProfile, incompleteCount, missingBiographyCount } =
        await runnableScenarios();

      const ordered = [...runnable].sort((a, b) =>
        b.generated_at.localeCompare(a.generated_at),
      );
      const page = paginate(ordered, input);

      // Executions are read for this page's scenarios only. The slice is taken
      // first on purpose: the grid is scenarios × flows, and reading all of it
      // to show three rows costs the whole benchmark's worth of files.
      const rows = await Promise.all(
        page.rows.map(async (scenario) => {
          const executions = await listExecutionsForScenario(
            scenario.profile_id,
            scenario.id,
          );
          const byFlow = new Map(
            executions.map((execution) => [execution.flow_key, execution]),
          );
          const description = byProfile.get(scenario.profile_id);

          return {
            scenario,
            // One entry per flow, in registry order, so every row has the same
            // columns whether or not that flow has run.
            cells: FLOWS.map((flow) => {
              const execution = byFlow.get(flow.key) ?? null;
              // The steps this scenario actually gets. A flow that branches on
              // the situation type runs fewer parts here than it declares, and
              // listing the declared ones would show a finished cell as forever
              // short of its last part.
              const steps = flowStepsFor(flow, scenario);

              /**
               * True when the execution was built from inputs that have since
               * changed — Stage 2 filled in this scenario's context after the
               * fact, or Stage 1 regenerated the biography into someone else.
               */
              const stale =
                execution !== null &&
                (execution.scenario_context_generated_at !==
                  scenario.context_generated_at ||
                  execution.description_generated_at !==
                    description?.generated_at);

              // The flow's actual claim, lifted out so the page can lead with
              // it rather than bury it under every intermediate field.
              const outcome = flow.outcome
                ? (execution?.steps[flow.outcome.stepKey]?.output[
                    flow.outcome.fieldKey
                  ]?.trim() ?? null)
                : null;

              return {
                flowKey: flow.key,
                flowLabel: flow.label,
                stale,
                outcome: outcome === "" ? null : outcome,
                outcomeLabel:
                  steps
                    .find((step) => step.key === flow.outcome?.stepKey)
                    ?.fields.find(
                      (field) => field.key === flow.outcome?.fieldKey,
                    )?.label ?? null,
                /**
                 * Every step of the flow, in order, each with its output if it
                 * has run. Steps are listed even when unrun so a half-finished
                 * flow shows where it stopped rather than simply looking short.
                 */
                steps: steps.map((step) => ({
                  key: step.key,
                  label: step.label,
                  fields: step.fields,
                  output: execution?.steps[step.key]?.output ?? null,
                })),
                // Counted by the same rule the planner schedules by, so the
                // page cannot report a full grid while the runner reports work
                // left to do.
                doneSteps: steps.filter((step) =>
                  stepIsComplete(execution, step),
                ).length,
                stepCount: steps.length,
              };
            }),
            /** Executions on disk for flows the registry no longer defines. */
            orphaned: executions.filter(
              (execution) =>
                !FLOWS.some((flow) => flow.key === execution.flow_key),
            ).length,
          };
        }),
      );

      return { ...page, rows, incompleteCount, missingBiographyCount };
    }),

  /**
   * How much of the grid is done, over the whole set rather than one page — the
   * runner needs the totals to say what a run will cost.
   *
   * Counted from the scenarios' own directories rather than by walking every
   * execution on disk, so records left behind by a deleted scenario or a removed
   * flow cannot inflate it.
   */
  coverage: publicProcedure.query(async () => {
    const { runnable, byProfile, incompleteCount, missingBiographyCount } =
      await runnableScenarios();

    const perScenario = await Promise.all(
      runnable.map(async (scenario) => {
        const executions = await listExecutionsForScenario(
          scenario.profile_id,
          scenario.id,
        );
        const description = byProfile.get(scenario.profile_id);

        return FLOWS.map((flow) => {
          const execution = executions.find(
            (candidate) => candidate.flow_key === flow.key,
          );
          const current =
            execution !== undefined &&
            execution.scenario_context_generated_at ===
              scenario.context_generated_at &&
            execution.description_generated_at === description?.generated_at;

          const steps = flowStepsFor(flow, scenario);

          return {
            flowKey: flow.key,
            /** Model calls this flow needs for this particular scenario. */
            stepCount: steps.length,
            // Steps that a skip-existing run would not have to redo.
            doneSteps: current
              ? steps.filter((step) => stepIsComplete(execution, step)).length
              : 0,
          };
        });
      }),
    );

    const flat = perScenario.flat();

    // Per flow rather than totalled: the runner selects flows individually, and
    // "how many calls will this cost" is only answerable for the ones actually
    // selected. A total would have to be scaled, and a scaled total is a guess
    // dressed as a count.
    const flows = FLOWS.map((flow) => {
      const entries = flat.filter((entry) => entry.flowKey === flow.key);

      return {
        key: flow.key,
        label: flow.label,
        /**
         * Parts the flow declares. A branching flow runs fewer on some
         * scenarios, so this describes the flow rather than promising a cost —
         * `totalSteps` is the figure that actually counts calls.
         */
        stepCount: flow.steps.length,
        /**
         * Model calls this flow needs to cover every runnable scenario, summed
         * per scenario rather than multiplied out: a flow that branches runs a
         * different number of parts on different scenarios, and a product would
         * overstate the cost of every run it appears in.
         */
        totalSteps: entries.reduce((total, entry) => total + entry.stepCount, 0),
        doneSteps: entries.reduce((total, entry) => total + entry.doneSteps, 0),
      };
    });

    return {
      scenarioCount: runnable.length,
      incompleteCount,
      missingBiographyCount,
      flows,
    };
  }),

  /**
   * What a run with these settings would do, without doing any of it.
   *
   * Deliberately not parameterised by the scenario limit: it returns the cost of
   * every scenario with outstanding work, in the order a limit takes them, and
   * the client sums a prefix. That keeps typing in the limit box free of round
   * trips, while the ordering and the per-scenario costs still come from the
   * planner the run itself uses.
   */
  plan: publicProcedure
    .input(
      z.object({
        flowKeys: z.array(z.string().min(1)),
        skipExisting: z.boolean(),
      }),
    )
    .query(async ({ input }) => {
      // An empty selection plans nothing rather than erroring: the checkboxes
      // pass through that state on the way to a different one, and a thrown
      // query would surface as an error message for a transient click.
      if (input.flowKeys.length === 0) {
        return { pendingSteps: [], scenarioCount: 0 };
      }

      const plan = await planFlowRun(input);

      return {
        /** Model calls each pending scenario would cost, in run order. */
        pendingSteps: plan.pending.map(stepsInPlan),
        scenarioCount: plan.scenarioCount,
      };
    }),

  /**
   * Starts a run over the selected flows and returns it immediately. The work
   * outlives this request — follow it through `runs.get`.
   */
  generate: publicProcedure
    .input(
      z.object({
        /** Which flows to run. Empty is a request for nothing, so it is refused. */
        flowKeys: z.array(z.string().min(1)).min(1),
        skipExisting: z.boolean(),
        /**
         * Cap on scenarios this run touches. Omitted runs every scenario with
         * outstanding work — the whole grid.
         */
        limit: z.number().int().min(1).optional(),
      }),
    )
    .mutation(({ input }) => {
      assertNoActiveRun("executions");

      return startRun({
        stage: "executions",
        model: configuredModel(),
        task: async (run) => {
          const summary = await runFlows({
            flowKeys: input.flowKeys,
            skipExisting: input.skipExisting,
            limit: input.limit,
            run,
          });

          const notes = [
            summary.limitedOut > 0 &&
              `Stopped at the ${input.limit}-scenario limit; ${summary.limitedOut} scenario(s) with work left for a later run.`,
            summary.skipped > 0 &&
              `Skipped ${summary.skipped} cell(s) already complete.`,
            summary.incompleteCount > 0 &&
              `Left out ${summary.incompleteCount} half-generated scenario(s) — re-run Stage 2 to finish them.`,
            summary.missingBiographyCount > 0 &&
              `Left out ${summary.missingBiographyCount} scenario(s) whose Stage 1 description is missing.`,
          ].filter((note): note is string => Boolean(note));

          return notes.length > 0 ? notes.join(" ") : undefined;
        },
      });
    }),
});
