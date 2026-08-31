import "server-only";

import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  scenarioSchema,
  stage2ConfigSchema,
  type Scenario,
  type Stage2Config,
} from "@/lib/stage-2";

/**
 * Scenarios live at `data/scenarios/<profile_id>/<scenario_id>.json`, so
 * a person's situations stay grouped on disk and re-running one person never
 * touches another's files. A person can have many scenarios — that is the
 * scenario axis of the person × scenario × flow grid.
 */
const SCENARIOS_DIR = path.join(process.cwd(), "data", "scenarios");

/** Hand-editable configuration for every Stage 2 call. */
const CONFIG_FILE = path.join(process.cwd(), "data", "stage-2-fields.json");

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Reads the editable Stage 2 config. A missing or malformed file fails loudly
 * rather than falling back to defaults — silent defaults would quietly discard
 * whatever was edited.
 */
export async function readStage2Config(): Promise<Stage2Config> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_FILE, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      throw new Error(
        `Stage 2 configuration missing: ${CONFIG_FILE}. Restore it to generate scenarios.`,
      );
    }
    throw error;
  }

  return stage2ConfigSchema.parse(JSON.parse(raw));
}

function profileDir(profileId: string): string | null {
  if (!SAFE_ID.test(profileId)) return null;
  return path.join(SCENARIOS_DIR, profileId);
}

export async function listScenariosForProfile(
  profileId: string,
): Promise<Scenario[]> {
  const dir = profileDir(profileId);
  if (!dir) return [];

  let entries: string[];
  try {
    entries = await readdir(dir);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const scenarios = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .sort()
      .map(async (entry) => {
        const raw = await readFile(path.join(dir, entry), "utf8");
        return scenarioSchema.parse(JSON.parse(raw));
      }),
  );

  // Newest first — a re-run's output should be what you see at the top.
  return scenarios.sort((a, b) =>
    b.generated_at.localeCompare(a.generated_at),
  );
}

export async function listAllScenarios(): Promise<Scenario[]> {
  let profileIds: string[];
  try {
    profileIds = await readdir(SCENARIOS_DIR);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const perProfile = await Promise.all(
    profileIds.sort().map((profileId) => listScenariosForProfile(profileId)),
  );
  return perProfile.flat();
}

export async function writeScenario(scenario: Scenario): Promise<void> {
  const dir = profileDir(scenario.profile_id);
  if (!dir || !SAFE_ID.test(scenario.id)) {
    throw new Error(`Unsafe scenario path: ${scenario.profile_id}/${scenario.id}`);
  }

  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, `${scenario.id}.json`),
    `${JSON.stringify(scenario, null, 2)}\n`,
    "utf8",
  );
}

/**
 * Deletes every scenario on disk, per-person directories included. Used when the
 * Stage 0 population is replaced — a scenario is about a specific person, and
 * that person is gone.
 */
export async function clearScenarios(): Promise<number> {
  let profileIds: string[];
  try {
    profileIds = await readdir(SCENARIOS_DIR);
  } catch (error) {
    if (isNotFound(error)) return 0;
    throw error;
  }

  const counts = await Promise.all(
    profileIds.map(async (profileId) => {
      const dir = profileDir(profileId);
      if (!dir) return 0;

      const scenarios = await listScenariosForProfile(profileId);
      await rm(dir, { recursive: true, force: true });
      return scenarios.length;
    }),
  );

  return counts.reduce((total, count) => total + count, 0);
}
