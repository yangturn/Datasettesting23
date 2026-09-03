import "server-only";

import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { executionSchema, type Execution } from "@/lib/stage-3";
import { writeJsonFile } from "@/server/storage/write-json";

/**
 * Executions live at
 * `data/executions/<profile_id>/<scenario_id>/<flow_key>.json` — one file per
 * cell of the scenario × flow grid, holding every step that flow has completed.
 *
 * The profile level is not decoration: scenario ids are
 * `scenario_<timestamp>_<index>` and people generate in parallel, so two people
 * whose first scenario lands in the same millisecond get the same id. Stage 2
 * gets away with it by grouping under the profile, and so does this.
 *
 * Keying the cell by path means re-running a flow overwrites in place, which is
 * what makes a partial run resumable rather than something to clean up first.
 */
const EXECUTIONS_DIR = path.join(process.cwd(), "data", "executions");

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function scenarioDir(profileId: string, scenarioId: string): string | null {
  if (!SAFE_ID.test(profileId) || !SAFE_ID.test(scenarioId)) return null;
  return path.join(EXECUTIONS_DIR, profileId, scenarioId);
}

/** Every flow's execution for one scenario, in whatever order they landed. */
export async function listExecutionsForScenario(
  profileId: string,
  scenarioId: string,
): Promise<Execution[]> {
  const dir = scenarioDir(profileId, scenarioId);
  if (!dir) return [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  return Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map(async (entry) => {
        const raw = await readFile(path.join(dir, entry), "utf8");
        return executionSchema.parse(JSON.parse(raw));
      }),
  );
}

/**
 * Every execution on disk. Used by the runner, which needs each cell's steps
 * and provenance to decide what is left to do.
 */
export async function listAllExecutions(): Promise<Execution[]> {
  let profileIds: string[];
  try {
    profileIds = await readdir(EXECUTIONS_DIR);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const perProfile = await Promise.all(
    profileIds.sort().map(async (profileId) => {
      if (!SAFE_ID.test(profileId)) return [];

      let scenarioIds: string[];
      try {
        scenarioIds = await readdir(path.join(EXECUTIONS_DIR, profileId));
      } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
      }

      const perScenario = await Promise.all(
        scenarioIds
          .sort()
          .map((scenarioId) =>
            listExecutionsForScenario(profileId, scenarioId),
          ),
      );
      return perScenario.flat();
    }),
  );

  return perProfile.flat();
}

/**
 * Writes the whole record. Called after every step rather than once at the end,
 * so a flow that dies in part 2 keeps the part 1 output already paid for.
 */
export async function writeExecution(execution: Execution): Promise<void> {
  const dir = scenarioDir(execution.profile_id, execution.scenario_id);
  if (!dir || !SAFE_ID.test(execution.flow_key)) {
    throw new Error(
      `Unsafe execution path: ${execution.profile_id}/${execution.scenario_id}/${execution.flow_key}`,
    );
  }

  await mkdir(dir, { recursive: true });
  await writeJsonFile(path.join(dir, `${execution.flow_key}.json`), execution);
}

/**
 * Deletes every execution on disk. Cascaded into when the population or the
 * scenarios are replaced — an execution is about one specific scenario, and a
 * replacing run leaves that scenario gone.
 *
 * Counts files rather than reading them: a clear must still work when something
 * under the tree no longer parses, which is exactly when you want to wipe it.
 */
export async function clearExecutions(): Promise<number> {
  let removed: number;
  try {
    const entries = await readdir(EXECUTIONS_DIR, { recursive: true });
    removed = entries.filter((entry) => entry.endsWith(".json")).length;
  } catch (error) {
    if (isNotFound(error)) return 0;
    throw error;
  }

  await rm(EXECUTIONS_DIR, { recursive: true, force: true });
  return removed;
}
