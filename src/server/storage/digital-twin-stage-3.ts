import "server-only";

import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  digitalTwinExecutionSchema,
  type DigitalTwinExecution,
} from "@/lib/digital-twin-stage-3";
import { writeJsonFile } from "@/server/storage/write-json";

const ROOT_DIR = path.join(process.cwd(), "data", "digital-twins", "stage-3");
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function executionDir(selectionId: string, profileId: string, episodeId: string) {
  for (const [label, value] of [
    ["selection id", selectionId],
    ["profile id", profileId],
    ["episode id", episodeId],
  ] as const) {
    if (!SAFE_ID.test(value)) throw new Error(`Unsafe Digital Twin ${label}: ${value}`);
  }
  return path.join(ROOT_DIR, selectionId, profileId, episodeId);
}

export async function writeDigitalTwinExecution(
  execution: DigitalTwinExecution,
): Promise<void> {
  const parsed = digitalTwinExecutionSchema.parse(execution);
  if (!SAFE_ID.test(parsed.flow_key)) {
    throw new Error(`Unsafe Digital Twin flow key: ${parsed.flow_key}`);
  }
  const dir = executionDir(parsed.selection_id, parsed.profile_id, parsed.episode_id);
  await mkdir(dir, { recursive: true });
  await writeJsonFile(path.join(dir, `${parsed.flow_key}.json`), parsed);
}

export async function listDigitalTwinExecutionsForEpisode(
  selectionId: string,
  profileId: string,
  episodeId: string,
): Promise<DigitalTwinExecution[]> {
  const dir = executionDir(selectionId, profileId, episodeId);
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
      .map(async (entry) =>
        digitalTwinExecutionSchema.parse(
          JSON.parse(await readFile(path.join(dir, entry), "utf8")),
        ),
      ),
  );
}

export async function listAllDigitalTwinExecutions(
  selectionId: string,
): Promise<DigitalTwinExecution[]> {
  const selectionPath = path.join(ROOT_DIR, selectionId);
  if (!SAFE_ID.test(selectionId)) throw new Error(`Unsafe Digital Twin selection id: ${selectionId}`);
  let profiles: string[];
  try {
    profiles = await readdir(selectionPath);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }
  const nested = await Promise.all(
    profiles.filter((id) => SAFE_ID.test(id)).sort().map(async (profileId) => {
      const episodes = await readdir(path.join(selectionPath, profileId));
      const records = await Promise.all(
        episodes.filter((id) => SAFE_ID.test(id)).sort().map((episodeId) =>
          listDigitalTwinExecutionsForEpisode(selectionId, profileId, episodeId),
        ),
      );
      return records.flat();
    }),
  );
  return nested.flat();
}
