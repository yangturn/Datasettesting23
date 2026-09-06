import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { paginate, paginationInputSchema } from "@/lib/pagination";
import {
  digitalTwinDatasetSize,
  importDigitalTwinProfiles,
} from "@/server/generation/digital-twin-profiles";
import {
  activeRunForStage,
  startRun,
} from "@/server/generation/runs";
import { readCurrentDigitalTwinSelection } from "@/server/storage/digital-twin-profiles";
import { createTRPCRouter, publicProcedure } from "@/server/trpc";

const RUN_STAGE = "digital-twin-profiles" as const;

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
});

