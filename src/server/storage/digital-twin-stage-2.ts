import "server-only";

import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  digitalTwinEpisodeSchema,
  type DigitalTwinEpisode,
} from "@/lib/digital-twin-stage-2";
import { writeJsonFile } from "@/server/storage/write-json";

const ROOT_DIR = path.join(process.cwd(), "data", "digital-twins", "stage-2");
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

export type DigitalTwinEpisodeRef = {
  profileId: string;
  episodeId: string;
};

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function assertSafe(value: string, label: string): void {
  if (!SAFE_ID.test(value)) throw new Error(`Unsafe ${label}: ${value}`);
}

function selectionDir(selectionId: string): string {
  assertSafe(selectionId, "Digital Twin selection id");
  return path.join(ROOT_DIR, selectionId);
}

function episodeFile(
  selectionId: string,
  profileId: string,
  episodeId: string,
): string {
  assertSafe(profileId, "Digital Twin profile id");
  assertSafe(episodeId, "Digital Twin episode id");
  return path.join(selectionDir(selectionId), profileId, `${episodeId}.json`);
}

export async function writeDigitalTwinEpisode(
  episode: DigitalTwinEpisode,
): Promise<void> {
  const parsed = digitalTwinEpisodeSchema.parse(episode);
  const file = episodeFile(parsed.selection_id, parsed.profile_id, parsed.id);
  await mkdir(path.dirname(file), { recursive: true });
  await writeJsonFile(file, parsed);
}

export async function readDigitalTwinEpisode(
  selectionId: string,
  profileId: string,
  episodeId: string,
): Promise<DigitalTwinEpisode | null> {
  try {
    const raw = await readFile(
      episodeFile(selectionId, profileId, episodeId),
      "utf8",
    );
    return digitalTwinEpisodeSchema.parse(JSON.parse(raw));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function listDigitalTwinEpisodeRefs(
  selectionId: string,
): Promise<DigitalTwinEpisodeRef[]> {
  let profileEntries;
  try {
    profileEntries = await readdir(selectionDir(selectionId), {
      withFileTypes: true,
    });
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const profileIds = profileEntries
    .filter((entry) => entry.isDirectory() && SAFE_ID.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));

  const perProfile = await Promise.all(
    profileIds.map(async (profileId) => {
      const entries = await readdir(path.join(selectionDir(selectionId), profileId));
      return entries
        .filter((entry) => entry.endsWith(".json"))
        .map((entry) => ({
          profileId,
          episodeId: entry.slice(0, -".json".length),
        }));
    }),
  );

  return perProfile
    .flat()
    .sort((a, b) =>
      `${a.profileId}/${a.episodeId}`.localeCompare(
        `${b.profileId}/${b.episodeId}`,
      ),
    );
}

