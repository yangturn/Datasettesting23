import { z } from "zod";

import { runStageSchema } from "@/lib/run";
import {
  activeRunForStage,
  cancelRun,
  getRun,
} from "@/server/generation/runs";
import { latestRunForStage } from "@/server/storage/runs";
import { createTRPCRouter, publicProcedure } from "@/server/trpc";

/**
 * Run status, shared by every stage.
 *
 * A generate mutation now returns as soon as its run exists, so this is how the
 * client follows the work: `latest` on page load, `get` while polling. Both are
 * plain reads — refreshing the page re-attaches to a run in progress rather
 * than restarting or abandoning it.
 */
export const runsRouter = createTRPCRouter({
  /** One run by id, live counts if this process owns it, else from disk. */
  get: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .query(async ({ input }) => getRun(input.id)),

  /**
   * The most recent run for a stage, whatever its status — what a page shows
   * before the client has a run id of its own.
   */
  latest: publicProcedure
    .input(z.object({ stage: runStageSchema }))
    .query(async ({ input }) => latestRunForStage(input.stage)),

  /** The run in flight for a stage, if any. */
  active: publicProcedure
    .input(z.object({ stage: runStageSchema }))
    .query(({ input }) => activeRunForStage(input.stage)),

  /**
   * Stops a run. Records already written stay written — cancelling is not a
   * rollback, and every generator's skip-existing makes the partial result
   * something the next run continues from.
   */
  cancel: publicProcedure
    .input(z.object({ id: z.string().min(1) }))
    .mutation(({ input }) => ({ cancelled: cancelRun(input.id) })),
});
