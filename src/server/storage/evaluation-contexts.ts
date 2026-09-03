import "server-only";

import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { evaluationContextSchema, type EvaluationContext } from "@/lib/stage-4";
import { writeJsonFile } from "@/server/storage/write-json";

/**
 * Evaluation contexts live at
 * `data/evaluation-contexts/<profile_id>/<scenario_id>.json` — one per scenario,
 * not one per scenario × flow.
 *
 * That cardinality is the point of Stage 4's first part: the context is built
 * without seeing any flow's prediction, so every flow is judged against the same
 * account of the same person. A per-flow context could drift between the arms
 * and turn a difference in the evaluator's picture into an apparent difference
 * in the flows.
 *
 * The profile level is not decoration: scenario ids are
 * `scenario_<timestamp>_<index>` and people generate in parallel, so two people
 * whose first scenario lands in the same millisecond get the same id.
 */
const CONTEXTS_DIR = path.join(process.cwd(), "data", "evaluation-contexts");

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function contextPath(profileId: string, scenarioId: string): string | null {
  if (!SAFE_ID.test(profileId) || !SAFE_ID.test(scenarioId)) return null;
  return path.join(CONTEXTS_DIR, profileId, `${scenarioId}.json`);
}

export async function readEvaluationContext(
  profileId: string,
  scenarioId: string,
): Promise<EvaluationContext | null> {
  const file = contextPath(profileId, scenarioId);
  if (!file) return null;

  let raw: string;
  try {
    raw = await readFile(file, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  return evaluationContextSchema.parse(JSON.parse(raw));
}

/** Every evaluation context on disk, for the planner and the coverage counts. */
export async function listAllEvaluationContexts(): Promise<
  EvaluationContext[]
> {
  let profileIds: string[];
  try {
    profileIds = await readdir(CONTEXTS_DIR);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const perProfile = await Promise.all(
    profileIds.sort().map(async (profileId) => {
      if (!SAFE_ID.test(profileId)) return [];

      let entries: string[];
      try {
        entries = await readdir(path.join(CONTEXTS_DIR, profileId));
      } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
      }

      return Promise.all(
        entries
          .filter((entry) => entry.endsWith(".json"))
          .sort()
          .map(async (entry) => {
            const raw = await readFile(
              path.join(CONTEXTS_DIR, profileId, entry),
              "utf8",
            );
            return evaluationContextSchema.parse(JSON.parse(raw));
          }),
      );
    }),
  );

  return perProfile.flat();
}

export async function writeEvaluationContext(
  context: EvaluationContext,
): Promise<void> {
  const file = contextPath(context.profile_id, context.scenario_id);
  if (!file) {
    throw new Error(
      `Unsafe evaluation context path: ${context.profile_id}/${context.scenario_id}`,
    );
  }

  await mkdir(path.dirname(file), { recursive: true });
  await writeJsonFile(file, context);
}

/**
 * Deletes every evaluation context. Cascaded into when the population or the
 * scenarios are replaced — a context is about one specific scenario, and a
 * replacing run leaves that scenario gone.
 *
 * Counts files rather than reading them: a clear must still work when something
 * under the tree no longer parses, which is exactly when you want to wipe it.
 */
export async function clearEvaluationContexts(): Promise<number> {
  let removed: number;
  try {
    const entries = await readdir(CONTEXTS_DIR, { recursive: true });
    removed = entries.filter((entry) => entry.endsWith(".json")).length;
  } catch (error) {
    if (isNotFound(error)) return 0;
    throw error;
  }

  await rm(CONTEXTS_DIR, { recursive: true, force: true });
  return removed;
}
