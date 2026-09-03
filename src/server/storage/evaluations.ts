import "server-only";

import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { evaluationSchema, type Evaluation } from "@/lib/stage-4";
import { writeJsonFile } from "@/server/storage/write-json";

/**
 * Evaluations live at
 * `data/evaluations/<profile_id>/<scenario_id>/<flow_key>.json` — one per
 * (scenario × flow), unlike the evaluation contexts they score against, which
 * are one per scenario. That asymmetry is the shape of the stage: one neutral
 * account of the person, several predictions judged against it.
 */
const EVALUATIONS_DIR = path.join(process.cwd(), "data", "evaluations");

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
  return path.join(EVALUATIONS_DIR, profileId, scenarioId);
}

/** Every flow's evaluation for one scenario. */
export async function listEvaluationsForScenario(
  profileId: string,
  scenarioId: string,
): Promise<Evaluation[]> {
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
        return evaluationSchema.parse(JSON.parse(raw));
      }),
  );
}

/** Every evaluation on disk, for the planner and the aggregate scores. */
export async function listAllEvaluations(): Promise<Evaluation[]> {
  let profileIds: string[];
  try {
    profileIds = await readdir(EVALUATIONS_DIR);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const perProfile = await Promise.all(
    profileIds.sort().map(async (profileId) => {
      if (!SAFE_ID.test(profileId)) return [];

      let scenarioIds: string[];
      try {
        scenarioIds = await readdir(path.join(EVALUATIONS_DIR, profileId));
      } catch (error) {
        if (isNotFound(error)) return [];
        throw error;
      }

      const perScenario = await Promise.all(
        scenarioIds
          .sort()
          .map((scenarioId) =>
            listEvaluationsForScenario(profileId, scenarioId),
          ),
      );
      return perScenario.flat();
    }),
  );

  return perProfile.flat();
}

export async function writeEvaluation(evaluation: Evaluation): Promise<void> {
  const dir = scenarioDir(evaluation.profile_id, evaluation.scenario_id);
  if (!dir || !SAFE_ID.test(evaluation.flow_key)) {
    throw new Error(
      `Unsafe evaluation path: ${evaluation.profile_id}/${evaluation.scenario_id}/${evaluation.flow_key}`,
    );
  }

  await mkdir(dir, { recursive: true });
  await writeJsonFile(
    path.join(dir, `${evaluation.flow_key}.json`),
    evaluation,
  );
}

/**
 * Deletes every evaluation. Cascaded into when the population, the scenarios, or
 * the flow executions are replaced — a score is about one specific predicted
 * action, and a replacing run leaves that action gone.
 *
 * Counts files rather than reading them: a clear must still work when something
 * under the tree no longer parses, which is exactly when you want to wipe it.
 */
export async function clearEvaluations(): Promise<number> {
  let removed: number;
  try {
    const entries = await readdir(EVALUATIONS_DIR, { recursive: true });
    removed = entries.filter((entry) => entry.endsWith(".json")).length;
  } catch (error) {
    if (isNotFound(error)) return 0;
    throw error;
  }

  await rm(EVALUATIONS_DIR, { recursive: true, force: true });
  return removed;
}
