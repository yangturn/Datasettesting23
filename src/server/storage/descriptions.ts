import "server-only";

import { mkdir, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

import {
  descriptionSchema,
  stage1ConfigSchema,
  type Description,
  type Stage1Config,
} from "@/lib/stage-1";
import { writeJsonFile } from "@/server/storage/write-json";

/**
 * Descriptions live at `data/descriptions/<profile_id>.json` — keyed by
 * the Stage 0 profile they expand, so regenerating one person overwrites in
 * place and can never leave two descriptions of the same profile behind.
 */
const DESCRIPTIONS_DIR = path.join(process.cwd(), "data", "descriptions");

/** Hand-editable configuration for the description prompt. */
const CONFIG_FILE = path.join(process.cwd(), "data", "stage-1-config.json");

const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/**
 * Reads the editable configuration. A missing or malformed file fails loudly
 * rather than falling back to defaults — silent defaults would quietly discard
 * whatever was edited.
 */
export async function readStage1Config(): Promise<Stage1Config> {
  let raw: string;
  try {
    raw = await readFile(CONFIG_FILE, "utf8");
  } catch (error) {
    if (isNotFound(error)) {
      throw new Error(
        `Stage 1 configuration missing: ${CONFIG_FILE}. Restore it to generate descriptions.`,
      );
    }
    throw error;
  }

  return stage1ConfigSchema.parse(JSON.parse(raw));
}

export async function readDescription(
  profileId: string,
): Promise<Description | null> {
  if (!SAFE_ID.test(profileId)) return null;

  let raw: string;
  try {
    raw = await readFile(
      path.join(DESCRIPTIONS_DIR, `${profileId}.json`),
      "utf8",
    );
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  return descriptionSchema.parse(JSON.parse(raw));
}

export async function listDescriptions(): Promise<Description[]> {
  let entries: string[];
  try {
    entries = await readdir(DESCRIPTIONS_DIR);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const ids = entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .sort((a, b) => a.localeCompare(b));

  const descriptions = await Promise.all(ids.map((id) => readDescription(id)));
  return descriptions.filter(
    (description): description is Description => description !== null,
  );
}

export async function writeDescription(
  description: Description,
): Promise<void> {
  if (!SAFE_ID.test(description.profile_id)) {
    throw new Error(`Unsafe profile id: ${description.profile_id}`);
  }

  await mkdir(DESCRIPTIONS_DIR, { recursive: true });
  await writeJsonFile(
    path.join(DESCRIPTIONS_DIR, `${description.profile_id}.json`),
    description,
  );
}

/**
 * Deletes every description on disk. Used when the Stage 0 population is
 * replaced: those descriptions describe people who no longer exist, and because
 * ids are reused they would otherwise be silently paired with whoever lands on
 * the same id next.
 */
export async function clearDescriptions(): Promise<number> {
  let entries: string[];
  try {
    entries = await readdir(DESCRIPTIONS_DIR);
  } catch (error) {
    if (isNotFound(error)) return 0;
    throw error;
  }

  const files = entries.filter((entry) => entry.endsWith(".json"));
  await Promise.all(
    files.map((file) => rm(path.join(DESCRIPTIONS_DIR, file), { force: true })),
  );

  return files.length;
}
