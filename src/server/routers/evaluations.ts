import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { paginate, paginationInputSchema } from "@/lib/pagination";
import { situationTypeSchema } from "@/lib/stage-2";
import { decisionModeFor, SCORE_SCALE_MAX } from "@/lib/stage-4";
import { FLOWS } from "@/server/flows";
import {
  callsInWork,
  planEvaluations,
  runEvaluations,
} from "@/server/generation/evaluations";
import { activeRunForStage, startRun } from "@/server/generation/runs";
import { configuredModel } from "@/server/llm/openrouter";
import { listDescriptions } from "@/server/storage/descriptions";
import { readEvaluationContext } from "@/server/storage/evaluation-contexts";
import { listEvaluationsForScenario } from "@/server/storage/evaluations";
import { listAllEvaluations } from "@/server/storage/evaluations";
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

/** Stage 4 — the independent context, then each flow's action scored against it. */
export const evaluationsRouter = createTRPCRouter({
  /** How much of Stage 4 is done, over the whole set rather than one page. */
  coverage: publicProcedure.query(async () => {
    const plan = await planEvaluations({ skipExisting: true });

    return {
      scenarioCount: plan.scenarioCount,
      incompleteCount: plan.incompleteCount,
      missingDescriptionCount: plan.missingDescriptionCount,
      unpredicted: plan.unpredicted,
      contextsDone: plan.contextsDone,
      scoresDone: plan.scoresDone,
      /** Cells the flows have answered — the denominator for scoring. */
      scorable: plan.scoresDone + plan.pending.reduce((t, w) => t + w.pendingScores.length, 0),
      flows: FLOWS.map((flow) => ({ key: flow.key, label: flow.label })),
    };
  }),

  /**
   * What a run with these settings would do. Not parameterised by the limit: it
   * returns the cost of each pending scenario in the order a limit takes them,
   * and the client sums a prefix, so typing in the limit box costs no round trip.
   */
  plan: publicProcedure
    .input(z.object({ skipExisting: z.boolean() }))
    .query(async ({ input }) => {
      const plan = await planEvaluations(input);
      return {
        pending: plan.pending.map((work) => ({
          calls: callsInWork(work),
          needsContext: work.needsContext,
          scores: work.pendingScores.length,
          mode: work.mode,
        })),
        scenarioCount: plan.scenarioCount,
      };
    }),

  /**
   * Aggregate scores per flow, over every evaluation on disk — the comparison
   * the whole benchmark exists to make.
   */
  scoreboard: publicProcedure
    .input(z.object({ situationType: situationTypeSchema.optional() }))
    .query(async ({ input }) => {
      const [evaluations, scenarios] = await Promise.all([
        listAllEvaluations(),
        listAllScenarios(),
      ]);

      // Evaluations record the scenario they judged but not its situation
      // type, so the filter is applied through the scenarios. Resolved here
      // rather than denormalised onto every evaluation, which would go stale
      // the moment a scenario was regenerated.
      const typeByScenario = new Map(
        scenarios.map((scenario) => [
          `${scenario.profile_id}/${scenario.id}`,
          scenario.situation_type,
        ]),
      );

      // Averaging across scales would be meaningless, so only evaluations on
      // the current one are aggregated. The rest are counted and reported, not
      // silently dropped — they are work that needs redoing, not work that
      // failed.
      const current = evaluations.filter(
        (evaluation) => evaluation.score_scale === SCORE_SCALE_MAX,
      );

      const inScope = current.filter(
        (evaluation) =>
          input.situationType === undefined ||
          typeByScenario.get(
            `${evaluation.profile_id}/${evaluation.scenario_id}`,
          ) === input.situationType,
      );

      const flows = FLOWS.map((flow) => {
        const mine = inScope.filter(
          (evaluation) => evaluation.flow_key === flow.key,
        );
        const mean = (pick: (e: (typeof mine)[number]) => number) =>
          mine.length === 0
            ? null
            : mine.reduce((total, e) => total + pick(e), 0) / mine.length;

        return {
          key: flow.key,
          label: flow.label,
          scored: mine.length,
          overall: mean((e) => e.overall_score),
          characterConsistency: mean((e) => e.scores.character_consistency),
          situationFit: mean((e) => e.scores.situation_fit),
          stateMemoryAlignment: mean((e) => e.scores.state_memory_alignment),
        };
      });

      // Counted per type over everything on disk, so the chips can show what
      // each one would narrow to before you click it.
      const byType = Object.fromEntries(
        situationTypeSchema.options.map((type) => [
          type,
          current.filter(
            (evaluation) =>
              typeByScenario.get(
                `${evaluation.profile_id}/${evaluation.scenario_id}`,
              ) === type,
          ).length,
        ]),
      ) as Record<string, number>;

      return {
        flows,
        scored: inScope.length,
        byType,
        scaleMax: SCORE_SCALE_MAX,
        /** Scored on a superseded scale; excluded above, re-run to include. */
        outdatedScale: evaluations.length - current.length,
      };
    }),

  /** One page of scenarios with their context and each flow's score. */
  list: publicProcedure
    .input(
      paginationInputSchema.extend({
        situationType: situationTypeSchema.optional(),
      }),
    )
    .query(async ({ input }) => {
      const [scenarios, descriptionList] = await Promise.all([
        listAllScenarios(),
        listDescriptions(),
      ]);

      const descriptions = new Map(
        descriptionList.map((d) => [d.profile_id, d]),
      );

      const runnable = scenarios
        .filter(
          (scenario) =>
            scenario.context_generated_at !== null &&
            descriptions.has(scenario.profile_id) &&
            // Applied before the slice, so the page numbers count filtered
            // rows rather than paging through a set the reader cannot see.
            (input.situationType === undefined ||
              scenario.situation_type === input.situationType),
        )
        .sort((a, b) => b.generated_at.localeCompare(a.generated_at));

      const page = paginate(runnable, input);

      const rows = await Promise.all(
        page.rows.map(async (scenario) => {
          const [context, evaluations] = await Promise.all([
            readEvaluationContext(scenario.profile_id, scenario.id),
            listEvaluationsForScenario(scenario.profile_id, scenario.id),
          ]);
          const description = descriptions.get(scenario.profile_id);
          const mode = decisionModeFor(
            situationTypeSchema.parse(scenario.situation_type),
          );
          const byFlow = new Map(
            evaluations.map((evaluation) => [evaluation.flow_key, evaluation]),
          );

          return {
            scenario,
            mode,
            context,
            /**
             * True when the context was built from inputs, or under a mode,
             * that no longer hold. A mode mismatch means the rule deciding
             * which memories are in scope has changed since it was written.
             */
            contextStale:
              context !== null &&
              (context.scenario_context_generated_at !==
                scenario.context_generated_at ||
                context.description_generated_at !==
                  description?.generated_at ||
                context.decision_mode !== mode),
            // One entry per flow, in registry order, so every row has the same
            // columns whether or not that flow has been scored.
            scores: FLOWS.map((flow) => {
              const evaluation = byFlow.get(flow.key) ?? null;
              return {
                flowKey: flow.key,
                flowLabel: flow.label,
                evaluation,
                /**
                 * Scored against a context that has since been rebuilt, or on a
                 * scale that has since changed. Either way the number shown is
                 * not comparable to the others.
                 */
                stale:
                  evaluation !== null &&
                  ((context !== null &&
                    evaluation.context_generated_at !==
                      context.generated_at) ||
                    evaluation.score_scale !== SCORE_SCALE_MAX),
              };
            }),
          };
        }),
      );

      return { ...page, rows };
    }),

  /**
   * Starts a Stage 4 run and returns it immediately. The work outlives this
   * request — follow it through `runs.get`.
   */
  generate: publicProcedure
    .input(
      z.object({
        skipExisting: z.boolean(),
        /** Cap on scenarios this run touches. Omitted runs every pending one. */
        limit: z.number().int().min(1).optional(),
      }),
    )
    .mutation(({ input }) => {
      assertNoActiveRun("evaluations");

      return startRun({
        stage: "evaluations",
        model: configuredModel(),
        task: async (run) => {
          const summary = await runEvaluations({
            skipExisting: input.skipExisting,
            limit: input.limit,
            run,
          });

          const notes = [
            (summary.contextsBuilt > 0 || summary.scored > 0) &&
              `Built ${summary.contextsBuilt} context(s) (${summary.reflective} reflective, ${summary.immediate} immediate) and scored ${summary.scored} prediction(s).`,
            summary.limitedOut > 0 &&
              `Stopped at the ${input.limit}-scenario limit; ${summary.limitedOut} left for a later run.`,
            summary.unpredicted > 0 &&
              `${summary.unpredicted} cell(s) had no Stage 3 prediction to score.`,
            summary.incompleteCount > 0 &&
              `Left out ${summary.incompleteCount} half-generated scenario(s).`,
          ].filter((note): note is string => Boolean(note));

          return notes.length > 0 ? notes.join(" ") : undefined;
        },
      });
    }),
});
