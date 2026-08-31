import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { generateScenarios } from "@/server/generation/scenarios";
import { activeRunForStage, startRun } from "@/server/generation/runs";
import { configuredModel } from "@/server/llm/openrouter";
import { MAX_CONCURRENT_REQUESTS } from "@/server/generation/runtime";
import { listDescriptions } from "@/server/storage/descriptions";
import { listAllScenarios, readStage2Config } from "@/server/storage/scenarios";
import { paginate, paginationInputSchema } from "@/lib/pagination";
import { createTRPCRouter, publicProcedure } from "@/server/trpc";

/** Stage 2 — scenarios written from Stage 1 descriptions. */
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

export const scenariosRouter = createTRPCRouter({
  /**
   * The Stage 2 config, so the page shows the live contents of
   * `data/stage-2-fields.json` rather than a hardcoded copy.
   */
  config: publicProcedure.query(async () => {
    const config = await readStage2Config();
    return {
      contextMaxItems: config.context_max_items_per_field,
      defaultPerPerson: config.default_per_person,
      maxPerPerson: config.max_per_person,
      situation: config.situation,
      contextSections: config.context_sections,
      maxConcurrent: MAX_CONCURRENT_REQUESTS,
    };
  }),

  /**
   * Every scenario, newest first, alongside how many people are available to
   * generate for — the page needs both to describe what a run will do.
   */
  list: publicProcedure
    .input(paginationInputSchema)
    .query(async ({ input }) => {
      const [descriptions, scenarios] = await Promise.all([
        listDescriptions(),
        listAllScenarios(),
      ]);

      const ordered = scenarios.sort((a, b) =>
        b.generated_at.localeCompare(a.generated_at),
      );

      return {
        ...paginate(ordered, input),
        // How many people are available to generate for — a whole-population
        // figure the page needs to describe what a run will do.
        personCount: descriptions.length,
      };
    }),

  /**
   * Generates `perPerson` scenarios for EVERY person with a Stage 1
   * description — added to what is there, or replacing all of it.
   */
  generate: publicProcedure
    .input(
      z.object({
        perPerson: z.number().int().min(1),
        mode: z.enum(["replace", "add"]),
      }),
    )
    .mutation(async ({ input }) => {
      assertNoActiveRun("scenarios");

      const config = await readStage2Config();

      // Rejected rather than clamped: silently generating 10 when 50 was asked
      // for makes the run record disagree with the request that produced it.
      if (input.perPerson > config.max_per_person) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `At most ${config.max_per_person} scenarios per person (asked for ${input.perPerson}). Raise "max_per_person" in data/stage-2-fields.json to go higher.`,
        });
      }

      const perPerson = input.perPerson;
      const mode = input.mode;

      return startRun({
        stage: "scenarios",
        model: configuredModel(),
        task: async (run) => {
          const summary = await generateScenarios({ perPerson, mode, run });
          if (summary.removed === 0) return undefined;

          const scenarios = `${summary.removed} previous ${
            summary.removed === 1 ? "scenario" : "scenarios"
          }`;

          const downstream = [
            summary.removedExecutions > 0 &&
              `${summary.removedExecutions} Stage 3 flow execution(s)`,
            summary.removedEvaluationContexts > 0 &&
              `${summary.removedEvaluationContexts} Stage 4 evaluation context(s)`,
            summary.removedEvaluations > 0 &&
              `${summary.removedEvaluations} Stage 4 evaluation(s)`,
          ].filter((part): part is string => Boolean(part));

          return downstream.length > 0
            ? `Deleted ${scenarios} and the ${downstream.join(" and ")} built from them.`
            : `Deleted ${scenarios}.`;
        },
      });
    }),
});
