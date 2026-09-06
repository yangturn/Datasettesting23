import { z } from "zod";

/**
 * A generation run — the record that outlives the request that started it.
 *
 * Generation takes minutes, and a run used to be welded to the HTTP request
 * that kicked it off: refreshing the page aborted the in-flight model calls and
 * threw away the summary, so failures that had already happened left no trace
 * anywhere. A run is now its own record on disk, written as items complete, and
 * the client polls it. Refreshing loses the view, not the work.
 *
 * Records live at `data/runs/<id>.json`, alongside every other JSON store, so a
 * finished run stays as readable and diffable as the people it generated.
 */

/** The stages that can be run. One generator each. */
export const RUN_STAGES = [
  "profiles",
  "digital-twin-profiles",
  "descriptions",
  "scenarios",
  "executions",
  "evaluations",
] as const;

export const runStageSchema = z.enum(RUN_STAGES);
export type RunStage = z.infer<typeof runStageSchema>;

/**
 * `running` is the only non-terminal state. A run left `running` by a killed
 * process is stale rather than live — see `isStale` in the runs registry.
 */
export const runStatusSchema = z.enum([
  "running",
  "succeeded",
  "failed",
  "cancelled",
]);
export type RunStatus = z.infer<typeof runStatusSchema>;

/** One item that failed, kept so a partial run is diagnosable after the fact. */
export const runErrorSchema = z.object({
  /** Whatever identifies the item to the user — usually a profile id. */
  id: z.string(),
  error: z.string(),
});

export const runRecordSchema = z.object({
  id: z.string(),
  stage: runStageSchema,
  status: runStatusSchema,
  /**
   * Items this run intends to process, or null while that is still unknown —
   * some generators only learn their target count after reading from disk.
   */
  total: z.number().int().nonnegative().nullable(),
  /** Items finished successfully. Written as each one lands, never batched. */
  done: z.number().int().nonnegative(),
  failed: z.number().int().nonnegative(),
  errors: z.array(runErrorSchema),
  model: z.string(),
  started_at: z.string(),
  /** Set once the run reaches a terminal status. */
  finished_at: z.string().nullable(),
  /** One line for the UI once the run ends — e.g. what it skipped. */
  message: z.string().nullable(),
});

export type RunRecord = z.infer<typeof runRecordSchema>;
export type RunError = z.infer<typeof runErrorSchema>;

/** True once the run reached a terminal status. */
export function isFinished(run: RunRecord): boolean {
  return run.status !== "running";
}

/**
 * Fraction complete, counting failures as processed — they are done being
 * attempted. Null while `total` is unknown, so the UI can show a count
 * without inventing a denominator.
 */
export function runProgress(run: RunRecord): number | null {
  if (run.total === null || run.total === 0) return null;
  return Math.min(1, (run.done + run.failed) / run.total);
}
