import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { paginate, paginationInputSchema } from "@/lib/pagination";
import {
  digitalTwinStage1MaxConcurrent,
  digitalTwinStage1TargetWords,
  generateDigitalTwinStage1,
} from "@/server/generation/digital-twin-stage-1";
import {
  digitalTwinStage2MaxConcurrent,
  digitalTwinTargetStats,
  generateDigitalTwinStage2,
} from "@/server/generation/digital-twin-stage-2";
import {
  digitalTwinDatasetSize,
  importDigitalTwinProfiles,
} from "@/server/generation/digital-twin-profiles";
import {
  activeRunForStage,
  startRun,
} from "@/server/generation/runs";
import { readCurrentDigitalTwinSelection } from "@/server/storage/digital-twin-profiles";
import { listDigitalTwinStage1Records } from "@/server/storage/digital-twin-stage-1";
import {
  listDigitalTwinEpisodeRefs,
  readDigitalTwinEpisode,
} from "@/server/storage/digital-twin-stage-2";
import { configuredModel } from "@/server/llm/openrouter";
import { createTRPCRouter, publicProcedure } from "@/server/trpc";

const RUN_STAGE = "digital-twin-profiles" as const;
const STAGE_1_RUN = "digital-twin-personas" as const;
const STAGE_2_RUN = "digital-twin-episodes" as const;

export const digitalTwinsRouter = createTRPCRouter({
  config: publicProcedure.query(async () => ({
    totalAvailable: await digitalTwinDatasetSize(),
  })),

  currentSelection: publicProcedure
    .input(paginationInputSchema)
    .query(async ({ input }) => {
      const selection = await readCurrentDigitalTwinSelection();
      if (!selection) return null;

      return {
        ...selection,
        profiles: undefined,
        ...paginate(selection.profiles, input),
      };
    }),

  stage1Config: publicProcedure.query(() => ({
    targetNarrativeWords: digitalTwinStage1TargetWords(),
    maxConcurrent: digitalTwinStage1MaxConcurrent(),
    model: configuredModel(),
  })),

  stage1List: publicProcedure
    .input(paginationInputSchema)
    .query(async ({ input }) => {
      const selection = await readCurrentDigitalTwinSelection();
      if (!selection) {
        return {
          selection: null,
          generatedCount: 0,
          ...paginate([], input),
        };
      }

      const records = await listDigitalTwinStage1Records(selection.id);
      const byProfile = new Map(
        records.map((record) => [record.profile_id, record]),
      );
      const rows = selection.profiles.map((profile) => {
        const persona = byProfile.get(profile.id) ?? null;
        const claimCount = persona
          ? persona.demographic_context.length +
            persona.values_and_beliefs.length +
            persona.personality_and_social_style.length +
            persona.decision_patterns.length +
            persona.risk_and_financial_preferences.length +
            persona.uncertainties_and_tensions.length
          : 0;
        return {
          profileId: profile.id,
          participantId: profile.participant_id,
          persona,
          claimCount,
        };
      });

      return {
        selection: {
          id: selection.id,
          seed: selection.seed,
          selectedCount: selection.selected_count,
        },
        generatedCount: records.length,
        ...paginate(rows, input),
      };
    }),

  stage2Config: publicProcedure.query(async () => ({
    ...(await digitalTwinTargetStats()),
    maxConcurrent: digitalTwinStage2MaxConcurrent(),
    model: configuredModel(),
  })),

  stage2List: publicProcedure
    .input(paginationInputSchema)
    .query(async ({ input }) => {
      const selection = await readCurrentDigitalTwinSelection();
      const stats = await digitalTwinTargetStats();
      if (!selection) {
        return {
          selection: null,
          personaCount: 0,
          currentCount: 0,
          staleCount: 0,
          targetQuestionCount: stats.questionCount,
          targetColumnCount: stats.targetColumnCount,
          ...paginate([], input),
        };
      }

      const [personas, refs] = await Promise.all([
        listDigitalTwinStage1Records(selection.id),
        listDigitalTwinEpisodeRefs(selection.id),
      ]);
      const personaDates = new Map(
        personas.map((persona) => [persona.profile_id, persona.generated_at]),
      );
      const allEpisodes = (
        await Promise.all(
          refs.map((ref) =>
            readDigitalTwinEpisode(selection.id, ref.profileId, ref.episodeId),
          ),
        )
      ).filter((episode) => episode !== null);
      const rows = allEpisodes.map((episode) => ({
        ...episode,
        contextItemCount: Object.values(episode.context).reduce(
          (count, value) =>
            count + value.split("\n").filter((line) => line.trim()).length,
          0,
        ),
        stale:
          personaDates.get(episode.profile_id) !== episode.stage1_generated_at,
      }));
      const currentCount = rows.filter((row) => !row.stale).length;

      return {
        selection: { id: selection.id, seed: selection.seed },
        personaCount: personas.length,
        currentCount,
        staleCount: rows.length - currentCount,
        targetQuestionCount: stats.questionCount,
        targetColumnCount: stats.targetColumnCount,
        ...paginate(rows, input),
      };
    }),

  processProfiles: publicProcedure
    .input(z.object({ count: z.number().int().min(1) }))
    .mutation(async ({ input }) => {
      const totalAvailable = await digitalTwinDatasetSize();
      if (input.count > totalAvailable) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Choose between 1 and ${totalAvailable} personas.`,
        });
      }

      const active = activeRunForStage(RUN_STAGE);
      if (active) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A Digital Twin profile run is already processing (${active.done} of ${active.total ?? "?"}).`,
        });
      }

      const stage1Active = activeRunForStage(STAGE_1_RUN);
      if (stage1Active) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Stage 1 is generating personas. Cancel it before replacing the selection.",
        });
      }
      if (activeRunForStage(STAGE_2_RUN)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Stage 2 is generating episodes. Cancel it before replacing the selection.",
        });
      }

      return startRun({
        stage: RUN_STAGE,
        model: "local Twin-2K-500 dataset",
        task: async (run) => {
          const result = await importDigitalTwinProfiles({
            count: input.count,
            run,
          });
          return `Selected ${input.count} personas at random. Seed: ${result.seed}`;
        },
      });
    }),

  generateStage1: publicProcedure
    .input(z.object({ skipExisting: z.boolean() }))
    .mutation(async ({ input }) => {
      const selection = await readCurrentDigitalTwinSelection();
      if (!selection) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Select Digital Twin participants in Stage 0 first.",
        });
      }
      if (activeRunForStage(RUN_STAGE)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Stage 0 is selecting participants. Wait for it to finish.",
        });
      }
      const active = activeRunForStage(STAGE_1_RUN);
      if (active) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A Digital Twin Stage 1 run is already going (${active.done} of ${active.total ?? "?"}).`,
        });
      }
      if (activeRunForStage(STAGE_2_RUN)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Stage 2 is generating episodes. Cancel it before regenerating Stage 1.",
        });
      }

      return startRun({
        stage: STAGE_1_RUN,
        model: configuredModel(),
        task: async (run) => {
          const summary = await generateDigitalTwinStage1({
            selection,
            skipExisting: input.skipExisting,
            run,
          });
          return summary.skipped > 0
            ? `Skipped ${summary.skipped} existing Stage 1 persona(s).`
            : undefined;
        },
      });
    }),

  generateStage2: publicProcedure
    .input(z.object({ skipExisting: z.boolean() }))
    .mutation(async ({ input }) => {
      const selection = await readCurrentDigitalTwinSelection();
      if (!selection) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Select Digital Twin participants in Stage 0 first.",
        });
      }
      if (activeRunForStage(RUN_STAGE) || activeRunForStage(STAGE_1_RUN)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "An earlier Digital Twins stage is still running.",
        });
      }
      const personas = await listDigitalTwinStage1Records(selection.id);
      if (personas.length === 0) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Generate at least one Stage 1 persona first.",
        });
      }
      const active = activeRunForStage(STAGE_2_RUN);
      if (active) {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A Digital Twin Stage 2 run is already going (${active.done} of ${active.total ?? "?"}).`,
        });
      }

      return startRun({
        stage: STAGE_2_RUN,
        model: configuredModel(),
        task: async (run) => {
          const summary = await generateDigitalTwinStage2({
            selection,
            skipExisting: input.skipExisting,
            run,
          });
          return summary.skipped > 0
            ? `Skipped ${summary.skipped} current episode(s).`
            : undefined;
        },
      });
    }),
});
