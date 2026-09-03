import "server-only";

import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import { profileSchema, type Profile } from "@/lib/profile";
import { writeJsonFile } from "@/server/storage/write-json";

/**
 * Profiles live as one JSON file per profile under `data/profiles/`, matching
 * how persons are stored — files are the source of truth and stay diffable.
 */
const PROFILES_DIR = path.join(process.cwd(), "data", "profiles");

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

async function listProfileIds(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(PROFILES_DIR);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  return entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .sort((a, b) => a.localeCompare(b));
}

export async function readProfile(profileId: string): Promise<Profile | null> {
  if (!SAFE_ID.test(profileId)) return null;

  let raw: string;
  try {
    raw = await readFile(path.join(PROFILES_DIR, `${profileId}.json`), "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  // Parse strictly — a malformed profile should fail loudly, not render blank.
  return profileSchema.parse(JSON.parse(raw));
}

export async function listProfiles(): Promise<Profile[]> {
  const ids = await listProfileIds();
  const profiles = await Promise.all(ids.map((id) => readProfile(id)));
  return profiles.filter((profile): profile is Profile => profile !== null);
}

export async function writeProfile(profile: Profile): Promise<void> {
  if (!SAFE_ID.test(profile.id)) {
    throw new Error(`Unsafe profile id: ${profile.id}`);
  }

  await mkdir(PROFILES_DIR, { recursive: true });
  await writeJsonFile(path.join(PROFILES_DIR, `${profile.id}.json`), profile);
}

/**
 * Next free sequence number, derived from the ids already on disk so an
 * additive run appends to the population instead of overwriting the start of it.
 */
export async function nextProfileNumber(): Promise<number> {
  const ids = await listProfileIds();

  const highest = ids.reduce((max, id) => {
    const match = /^profile_(\d+)$/.exec(id);
    return match ? Math.max(max, Number(match[1])) : max;
  }, 0);

  return highest + 1;
}

/**
 * Deletes every profile on disk — used by a replacing run, so ids and diversity
 * slots start from a clean slate and can never collide with a previous run's.
 *
 * Only files this module writes are touched — anything else in the directory is
 * left alone. Returns how many were removed.
 */
export async function clearProfiles(): Promise<number> {
  const ids = await listProfileIds();

  await Promise.all(
    ids.map((id) => rm(path.join(PROFILES_DIR, `${id}.json`), { force: true })),
  );

  return ids.length;
}

export function profileId(sequence: number): string {
  return `profile_${String(sequence).padStart(3, "0")}`;
}
