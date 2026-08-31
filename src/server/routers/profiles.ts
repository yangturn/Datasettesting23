import { TRPCError } from "@trpc/server";
import { z } from "zod";

import {
  generateProfiles,
  maxProfilesPerRun,
  profilesPerRequest,
} from "@/server/generation/profiles";
import { activeRunForStage, startRun } from "@/server/generation/runs";
import { MAX_CONCURRENT_REQUESTS } from "@/server/generation/runtime";
import { configuredModel } from "@/server/llm/openrouter";
import { listProfiles, readProfile } from "@/server/storage/profiles";
import { createTRPCRouter, publicProcedure } from "@/server/trpc";
import { paginate, paginationInputSchema } from "@/lib/pagination";
import type { Profile } from "@/lib/profile";

/**
 * Refuses a second run while one is in flight. Two runs writing the same
 * records would interleave, and both would report counts that were never true
 * of the files on disk.
 */
function assertNoActiveRun() {
  const active = activeRunForStage("profiles");
  if (active) {
    throw new TRPCError({
      code: "CONFLICT",
      message: `A profiles run is already going (${active.done} of ${active.total ?? "?"} done). Cancel it first.`,
    });
  }
}

/** Distinct values the population actually covers on each axis. */
function coverage(profiles: Profile[]) {
  const distinct = (pick: (profile: Profile) => string) =>
    new Set(profiles.map(pick)).size;

  return [
    { label: "regions", value: distinct((p) => p.seed.region) },
    { label: "age bands", value: distinct((p) => p.seed.age_band) },
    { label: "domains", value: distinct((p) => p.seed.domain) },
    { label: "life stages", value: distinct((p) => p.seed.life_stage) },
    { label: "temperaments", value: distinct((p) => p.seed.temperament) },
  ];
}

export const profilesRouter = createTRPCRouter({
  /**
   * One page of profiles. `coverage` is measured over the whole population, not
   * the page — it describes how diverse the run was, which a single page can't
   * show.
   */
  list: publicProcedure
    .input(paginationInputSchema)
    .query(async ({ input }) => {
      const profiles = await listProfiles();
      // Newest first — a run's output should be what you see at the top.
      const ordered = profiles.slice().reverse();

      return {
        ...paginate(ordered, input),
        coverage: coverage(profiles),
      };
    }),

  byId: publicProcedure
    .input(z.object({ profileId: z.string().min(1) }))
    .query(async ({ input }) => {
      const profile = await readProfile(input.profileId);
      if (!profile) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `No profile with id "${input.profileId}"`,
        });
      }
      return profile;
    }),

  /**
   * The run limits, so the UI can show what a run will actually do — how many
   * calls, of what size — instead of hardcoding numbers that could drift from
   * the environment.
   */
  config: publicProcedure.query(() => ({
    maxPerRun: maxProfilesPerRun(),
    perRequest: profilesPerRequest(),
    maxConcurrent: MAX_CONCURRENT_REQUESTS,
    model: configuredModel(),
  })),

  /**
   * Generates `count` diverse profiles. `replace` deletes the existing
   * population first; `add` extends it on unused diversity slots.
   */
  generate: publicProcedure
    .input(
      z.object({
        count: z.number().int().min(1),
        mode: z.enum(["replace", "add"]),
      }),
    )
    .mutation(({ input }) => {
      // Checked here rather than in the input schema so the ceiling is read
      // from the environment per request instead of frozen at module load.
      // Bounds one run only — the population itself is uncapped, so repeated
      // additive runs can grow it past this.
      const max = maxProfilesPerRun();
      if (input.count > max) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Requested ${input.count} profiles in one run; MAX_PROFILES_PER_RUN is ${max}.`,
        });
      }

      assertNoActiveRun();

      return startRun({
        stage: "profiles",
        model: configuredModel(),
        task: async (run) => {
          const summary = await generateProfiles({
            count: input.count,
            mode: input.mode,
            run,
          });
          if (summary.removed === 0) return undefined;

          const downstream = [
            summary.removedDescriptions > 0
              ? `${summary.removedDescriptions} description(s)`
              : null,
            summary.removedScenarios > 0
              ? `${summary.removedScenarios} scenario(s)`
              : null,
            summary.removedExecutions > 0
              ? `${summary.removedExecutions} flow execution(s)`
              : null,
            summary.removedEvaluationContexts > 0
              ? `${summary.removedEvaluationContexts} evaluation context(s)`
              : null,
            summary.removedEvaluations > 0
              ? `${summary.removedEvaluations} evaluation(s)`
              : null,
          ].filter((part): part is string => part !== null);

          return downstream.length > 0
            ? `Replaced the population, deleting ${summary.removed} profile(s) and the ${downstream.join(" and ")} derived from them.`
            : `Replaced the population, deleting ${summary.removed} profile(s).`;
        },
      });
    }),
});
