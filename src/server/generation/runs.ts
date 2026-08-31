import "server-only";

import { randomBytes } from "node:crypto";

import type { RunError, RunRecord, RunStage } from "@/lib/run";
import { readRun, writeRun } from "@/server/storage/runs";

/**
 * The live side of a run: the record on disk plus the controller that can stop
 * it. Generation is started by a request but must not be owned by one, so the
 * request handler returns as soon as the run exists and the work continues here.
 *
 * Kept on `globalThis` rather than in module scope because `next dev` discards
 * module state on every recompile — a run started before an edit would
 * otherwise keep spending tokens with nothing tracking it.
 */
type LiveRun = {
  controller: AbortController;
  record: RunRecord;
};

const REGISTRY_KEY = "__generatorRunRegistry";

type RegistryHost = typeof globalThis & {
  [REGISTRY_KEY]?: Map<string, LiveRun>;
};

function registry(): Map<string, LiveRun> {
  const host = globalThis as RegistryHost;
  host[REGISTRY_KEY] ??= new Map<string, LiveRun>();
  return host[REGISTRY_KEY];
}

/** What a generator gets to report progress with. */
export type RunContext = {
  /** Aborted by an explicit cancel — never by a client disconnecting. */
  signal: AbortSignal;
  /** Called once the generator knows how many items it will attempt. */
  setTotal: (total: number) => void;
  /**
   * `count` above 1 is for generators that call the model once per batch of
   * items — progress is reported in items so the denominator stays the thing
   * the user asked for, not the request count it happened to take.
   */
  itemDone: (count?: number) => void;
  itemFailed: (error: RunError, count?: number) => void;
};

function newRunId(stage: RunStage): string {
  return `run_${stage}_${Date.now().toString(36)}_${randomBytes(3).toString("hex")}`;
}

/**
 * Starts a run and returns its record immediately — the caller is a request
 * handler, and awaiting the work here is exactly the bug this replaces.
 *
 * Progress is flushed to disk as items land rather than at the end, so a run
 * interrupted by a killed process still shows how far it got.
 */
export function startRun({
  stage,
  model,
  task,
}: {
  stage: RunStage;
  model: string;
  task: (context: RunContext) => Promise<string | void>;
}): RunRecord {
  const controller = new AbortController();

  const record: RunRecord = {
    id: newRunId(stage),
    stage,
    status: "running",
    total: null,
    done: 0,
    failed: 0,
    errors: [],
    model,
    started_at: new Date().toISOString(),
    finished_at: null,
    message: null,
  };

  const live: LiveRun = { controller, record };
  registry().set(record.id, live);

  // Fire-and-forget on purpose: writes are chained per id in the storage layer,
  // so a dropped flush cannot corrupt the file, and losing one intermediate
  // progress write is harmless — the next item rewrites the whole record.
  const flush = () => void writeRun(live.record).catch(() => {});

  flush();

  const context: RunContext = {
    signal: controller.signal,
    setTotal: (total) => {
      live.record = { ...live.record, total };
      flush();
    },
    itemDone: (count = 1) => {
      live.record = { ...live.record, done: live.record.done + count };
      flush();
    },
    itemFailed: (error, count = 1) => {
      // A cancel makes every remaining item fail instantly on the aborted
      // signal. Those are the cancel, not findings, so they are not recorded.
      if (controller.signal.aborted) return;
      live.record = {
        ...live.record,
        failed: live.record.failed + count,
        errors: [...live.record.errors, error],
      };
      flush();
    },
  };

  void (async () => {
    let status: RunRecord["status"] = "succeeded";
    let message: string | null = null;

    try {
      message = (await task(context)) ?? null;
    } catch (error) {
      status = "failed";
      message = error instanceof Error ? error.message : String(error);
    }

    // A cancelled run is cancelled however its task unwound — most abort paths
    // surface as a thrown fetch error rather than a clean return.
    if (controller.signal.aborted) {
      status = "cancelled";
      message = "Cancelled. Everything generated before the cancel was kept.";
    }

    live.record = {
      ...live.record,
      status,
      message,
      finished_at: new Date().toISOString(),
    };

    await writeRun(live.record).catch(() => {});
    registry().delete(record.id);
  })();

  return record;
}

/** The in-memory record if this process owns the run, else null. */
export function liveRun(id: string): RunRecord | null {
  return registry().get(id)?.record ?? null;
}

/** The active run for a stage, if this process is running one. */
export function activeRunForStage(stage: RunStage): RunRecord | null {
  for (const live of registry().values()) {
    if (live.record.stage === stage) return live.record;
  }
  return null;
}

/**
 * Signals a run to stop. Items already written stay written — cancelling is not
 * a rollback, and `skipExisting` makes the partial result a resumable one.
 */
export function cancelRun(id: string): boolean {
  const live = registry().get(id);
  if (!live) return false;
  live.controller.abort();
  return true;
}

/**
 * Reads a run, preferring the in-memory copy — it is strictly fresher than the
 * file, since progress writes are flushed without being awaited.
 *
 * A record still marked `running` that no live run backs was stranded by a
 * killed or restarted process. Reporting it as running would leave the UI
 * polling forever, so it is settled to `failed` once, on disk, with the counts
 * it reached.
 */
export async function getRun(id: string): Promise<RunRecord | null> {
  const live = liveRun(id);
  if (live) return live;

  const stored = await readRun(id);
  if (!stored || stored.status !== "running") return stored;

  const settled: RunRecord = {
    ...stored,
    status: "failed",
    finished_at: new Date().toISOString(),
    message:
      "Interrupted — the server stopped while this run was going. " +
      "Everything generated before that was kept; run again to continue.",
  };

  await writeRun(settled).catch(() => {});
  return settled;
}
