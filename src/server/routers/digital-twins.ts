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
  callsInDigitalTwinPlanEntry,
  generateDigitalTwinStage3,
  planDigitalTwinStage3,
} from "@/server/generation/digital-twin-stage-3";
import { FLOWS, flowMeta } from "@/server/flows";
import { MAX_CONCURRENT_REQUESTS } from "@/server/generation/runtime";
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
import { listDigitalTwinExecutionsForEpisode } from "@/server/storage/digital-twin-stage-3";
import { configuredModel } from "@/server/llm/openrouter";
import { createTRPCRouter, publicProcedure } from "@/server/trpc";
import { buildDigitalTwinStage4Report } from "@/server/evaluation/digital-twin-stage-4";

const RUN_STAGE = "digital-twin-profiles" as const;
const STAGE_1_RUN = "digital-twin-personas" as const;
const STAGE_2_RUN = "digital-twin-episodes" as const;
const STAGE_3_RUN = "digital-twin-executions" as const;

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

  stage3Config: publicProcedure.query(() => ({
    flows: flowMeta(),
    maxConcurrent: MAX_CONCURRENT_REQUESTS,
    model: configuredModel(),
  })),

  stage3List: publicProcedure
    .input(paginationInputSchema)
    .query(async ({ input }) => {
      const selection = await readCurrentDigitalTwinSelection();
      if (!selection) return { selection: null, completeCells: 0, totalCells: 0, ...paginate([], input) };
      const [personas, refs] = await Promise.all([
        listDigitalTwinStage1Records(selection.id),
        listDigitalTwinEpisodeRefs(selection.id),
      ]);
      const personaDates = new Map(personas.map((persona) => [persona.profile_id, persona.generated_at]));
      const episodes = (await Promise.all(refs.map((ref) => readDigitalTwinEpisode(selection.id, ref.profileId, ref.episodeId))))
        .filter((episode) => episode !== null)
        .filter((episode) => personaDates.get(episode.profile_id) === episode.stage1_generated_at)
        .sort((a, b) => `${a.profile_id}/${a.task_key}`.localeCompare(`${b.profile_id}/${b.task_key}`));
      const allRows = await Promise.all(episodes.map(async (episode) => {
        const executions = await listDigitalTwinExecutionsForEpisode(selection.id, episode.profile_id, episode.id);
        const byFlow = new Map(executions.map((execution) => [execution.flow_key, execution]));
        return {
          episode,
          cells: FLOWS.map((flow) => {
            const execution = byFlow.get(flow.key) ?? null;
            const stale = execution !== null && (execution.stage1_generated_at !== episode.stage1_generated_at || execution.episode_generated_at !== episode.generated_at);
            const doneSteps = stale ? 0 : Object.keys(execution?.steps ?? {}).length + (execution?.answers ? 1 : 0);
            return { flowKey: flow.key, flowLabel: flow.label, stale, doneSteps, stepCount: flow.steps.length, answers: stale ? null : execution?.answers ?? null };
          }),
        };
      }));
      const completeCells = allRows.flatMap((row) => row.cells).filter((cell) => cell.doneSteps === cell.stepCount).length;
      return { selection: { id: selection.id, seed: selection.seed }, completeCells, totalCells: episodes.length * FLOWS.length, ...paginate(allRows, input) };
    }),

  stage3Plan: publicProcedure
    .input(z.object({ flowKeys: z.array(z.string()), skipExisting: z.boolean() }))
    .query(async ({ input }) => {
      const selection = await readCurrentDigitalTwinSelection();
      if (!selection || input.flowKeys.length === 0) return { episodeCount: 0, pendingCalls: [] as number[] };
      const plan = await planDigitalTwinStage3({ selectionId: selection.id, ...input });
      const grouped = new Map<string, number>();
      for (const entry of plan.entries) {
        const key = `${entry.episode.profile_id}/${entry.episode.id}`;
        grouped.set(key, (grouped.get(key) ?? 0) + callsInDigitalTwinPlanEntry(entry));
      }
      return { episodeCount: plan.episodeCount, pendingCalls: [...grouped.values()] };
    }),

  stage4Report: publicProcedure.query(async () => {
    const selection = await readCurrentDigitalTwinSelection();
    return selection ? buildDigitalTwinStage4Report(selection.id) : null;
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
      if (activeRunForStage(STAGE_3_RUN)) {
        throw new TRPCError({ code: "CONFLICT", message: "Stage 3 is running. Cancel it before replacing the selection." });
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
      if (activeRunForStage(STAGE_3_RUN)) {
        throw new TRPCError({ code: "CONFLICT", message: "Stage 3 is running. Cancel it before regenerating Stage 1." });
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
      if (activeRunForStage(STAGE_3_RUN)) {
        throw new TRPCError({
          code: "CONFLICT",
          message: "Stage 3 is running. Cancel it before regenerating Stage 2.",
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

  generateStage3: publicProcedure
    .input(z.object({ flowKeys: z.array(z.string().min(1)).min(1), skipExisting: z.boolean(), limit: z.number().int().min(1).optional() }))
    .mutation(async ({ input }) => {
      const selection = await readCurrentDigitalTwinSelection();
      if (!selection) throw new TRPCError({ code: "PRECONDITION_FAILED", message: "Select Digital Twin participants first." });
      if (activeRunForStage(RUN_STAGE) || activeRunForStage(STAGE_1_RUN) || activeRunForStage(STAGE_2_RUN)) {
        throw new TRPCError({ code: "CONFLICT", message: "An earlier Digital Twins stage is still running." });
      }
      const active = activeRunForStage(STAGE_3_RUN);
      if (active) throw new TRPCError({ code: "CONFLICT", message: `A Digital Twin Stage 3 run is already going (${active.done} of ${active.total ?? "?"}).` });
      return startRun({
        stage: STAGE_3_RUN,
        model: configuredModel(),
        task: async (run) => {
          const summary = await generateDigitalTwinStage3({ selectionId: selection.id, ...input, run });
          const notes = [summary.skipped > 0 && `Skipped ${summary.skipped} complete flow cells.`, summary.limitedOut > 0 && `Left ${summary.limitedOut} episode(s) for a later run.`].filter((note): note is string => Boolean(note));
          return notes.length ? notes.join(" ") : undefined;
        },
      });
    }),
});
