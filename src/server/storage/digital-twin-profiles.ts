import "server-only";

import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";

import {
  digitalTwinProfileSchema,
  digitalTwinSelectionSchema,
  type DigitalTwinProfile,
  type DigitalTwinSelection,
} from "@/lib/digital-twin";
import { writeJsonFile } from "@/server/storage/write-json";

const ROOT_DIR = path.join(process.cwd(), "data", "digital-twins", "stage-0");
const SELECTIONS_DIR = path.join(ROOT_DIR, "selections");
const CURRENT_FILE = path.join(ROOT_DIR, "current.json");
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

const currentSelectionSchema = z.object({ selection_id: z.string() });

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function selectionDir(selectionId: string): string {
  if (!SAFE_ID.test(selectionId)) {
    throw new Error(`Unsafe Digital Twin selection id: ${selectionId}`);
  }
  return path.join(SELECTIONS_DIR, selectionId);
}

export async function writeDigitalTwinProfile(
  profile: DigitalTwinProfile,
): Promise<void> {
  const parsed = digitalTwinProfileSchema.parse(profile);
  const profilesDir = path.join(selectionDir(parsed.selection_id), "profiles");
  await mkdir(profilesDir, { recursive: true });
  await writeJsonFile(path.join(profilesDir, `${parsed.id}.json`), parsed);
}

export async function activateDigitalTwinSelection(
  selection: DigitalTwinSelection,
): Promise<void> {
  const parsed = digitalTwinSelectionSchema.parse(selection);
  const dir = selectionDir(parsed.id);
  await mkdir(dir, { recursive: true });
  await writeJsonFile(path.join(dir, "manifest.json"), parsed);
  // The pointer is written last, so the UI never observes a partial selection.
  await mkdir(ROOT_DIR, { recursive: true });
  await writeJsonFile(CURRENT_FILE, { selection_id: parsed.id });
}

export async function readCurrentDigitalTwinSelection(): Promise<DigitalTwinSelection | null> {
  let currentRaw: string;
  try {
    currentRaw = await readFile(CURRENT_FILE, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  const { selection_id: selectionId } = currentSelectionSchema.parse(
    JSON.parse(currentRaw),
  );

  try {
    const manifestRaw = await readFile(
      path.join(selectionDir(selectionId), "manifest.json"),
      "utf8",
    );
    return digitalTwinSelectionSchema.parse(JSON.parse(manifestRaw));
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

