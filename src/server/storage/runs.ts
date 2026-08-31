import "server-only";

import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { runRecordSchema, type RunRecord, type RunStage } from "@/lib/run";

/**
 * Run records live at `data/runs/<id>.json`, one file per run. Flat rather than
 * nested by stage: a run is identified by its id everywhere, and the stage is a
 * field on the record.
 */
const RUNS_DIR = path.join(process.cwd(), "data", "runs");

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function pathFor(id: string): string {
  return path.join(RUNS_DIR, `${id}.json`);
}

export async function readRun(id: string): Promise<RunRecord | null> {
  if (!SAFE_ID.test(id)) return null;

  let raw: string;
  try {
    raw = await readFile(pathFor(id), "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  return runRecordSchema.parse(JSON.parse(raw));
}

/**
 * Serialises writes per run id. A run's workers all call in concurrently as
 * their items land, and two overlapping `writeFile` calls on one path can
 * interleave into a truncated file — chaining them keeps the last write the
 * one that survives.
 */
const writeChains = new Map<string, Promise<void>>();

export async function writeRun(run: RunRecord): Promise<void> {
  if (!SAFE_ID.test(run.id)) {
    throw new Error(`Unsafe run id: ${run.id}`);
  }

  const previous = writeChains.get(run.id) ?? Promise.resolve();
  const next = previous
    .catch(() => {})
    .then(async () => {
      await mkdir(RUNS_DIR, { recursive: true });
      await writeFile(
        pathFor(run.id),
        `${JSON.stringify(run, null, 2)}\n`,
        "utf8",
      );
    });

  writeChains.set(run.id, next);
  try {
    await next;
  } finally {
    // Only the last writer clears the chain, so a slower one still queues.
    if (writeChains.get(run.id) === next) writeChains.delete(run.id);
  }
}

/** Every run on disk, newest first. */
export async function listRuns(): Promise<RunRecord[]> {
  let entries: string[];
  try {
    entries = await readdir(RUNS_DIR);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const ids = entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length));

  /**
   * A record that no longer validates is skipped rather than thrown — history
   * from a removed stage, or from an older shape of the schema, must not take
   * out the run listing for every stage that still exists.
   */
  const records = await Promise.all(
    ids.map((id) => readRun(id).catch(() => null)),
  );

  return records
    .filter((record): record is RunRecord => record !== null)
    .sort((a, b) => b.started_at.localeCompare(a.started_at));
}

/**
 * The most recent run for one stage, whatever its status — this is what a page
 * shows on load, so a run started before a refresh is still visible after it.
 */
export async function latestRunForStage(
  stage: RunStage,
): Promise<RunRecord | null> {
  const runs = await listRuns();
  return runs.find((run) => run.stage === stage) ?? null;
}
