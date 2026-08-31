import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { generateDescriptions } from "@/server/generation/descriptions";
import { activeRunForStage, startRun } from "@/server/generation/runs";
import { configuredModel } from "@/server/llm/openrouter";
import { MAX_CONCURRENT_REQUESTS } from "@/server/generation/runtime";
import {
  listDescriptions,
  readStage1Config,
} from "@/server/storage/descriptions";
import { listProfiles } from "@/server/storage/profiles";
import { paginate, paginationInputSchema } from "@/lib/pagination";
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

/** Stage 1 — long descriptions expanded from Stage 0 profiles. */
export const descriptionsRouter = createTRPCRouter({
  /**
   * Every Stage 0 profile with its description, if it has one — the page needs
   * both to show what this stage still has left to cover.
   */
  list: publicProcedure
    .input(paginationInputSchema)
    .query(async ({ input }) => {
      const [profiles, descriptions] = await Promise.all([
        listProfiles(),
        listDescriptions(),
      ]);

      const byProfile = new Map(
        descriptions.map((description) => [
          description.profile_id,
          description,
        ]),
      );

      const rows = profiles.map((profile) => {
        const description = byProfile.get(profile.id) ?? null;

        /**
         * True when the description on this id was written from a different
         * profile than the one now sitting there. Profile ids are sequence
         * numbers and a replacing Stage 0 run restarts the sequence, so the id
         * matching alone cannot be trusted — the timestamps can. A null
         * `profile_generated_at` predates the field, so its provenance is
         * unknown and it counts as stale.
         */
        const stale =
          description !== null &&
          description.profile_generated_at !== profile.generated_at;

        return {
          profileId: profile.id,
          name: profile.name,
          headline: profile.headline,
          description,
          stale,
        };
      });

      return {
        ...paginate(rows, input),
        // Counted over every profile, not the page — this is run progress. A
        // stale description does not count as described; regenerating replaces
        // it, so it is work still outstanding.
        describedCount: rows.filter(
          (row) => row.description !== null && !row.stale,
        ).length,
        staleCount: rows.filter((row) => row.stale).length,
      };
    }),

  /**
   * The editable config driving the prompt, so the page shows the live
   * contents of `data/stage-1-config.json` rather than a hardcoded copy.
   */
  fields: publicProcedure.query(async () => {
    const config = await readStage1Config();
    return {
      targetWordCount: config.target_word_count,
      maxConcurrent: MAX_CONCURRENT_REQUESTS,
    };
  }),

  /**
   * Starts a run across ALL Stage 0 profiles and returns it immediately. The
   * work outlives this request — follow it through `runs.get`.
   */
  generate: publicProcedure
    .input(z.object({ skipExisting: z.boolean() }))
    .mutation(({ input }) => {
      assertNoActiveRun("descriptions");

      return startRun({
        stage: "descriptions",
        model: configuredModel(),
        task: async (run) => {
          const summary = await generateDescriptions({
            skipExisting: input.skipExisting,
            run,
          });
          return summary.skipped > 0
            ? `Skipped ${summary.skipped} that already had a description.`
            : undefined;
        },
      });
    }),
});
