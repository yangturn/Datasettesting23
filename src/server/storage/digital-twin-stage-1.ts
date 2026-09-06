import "server-only";

import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";

import {
  digitalTwinStage1RecordSchema,
  type DigitalTwinStage1Record,
} from "@/lib/digital-twin-stage-1";
import { writeJsonFile } from "@/server/storage/write-json";

const ROOT_DIR = path.join(process.cwd(), "data", "digital-twins", "stage-1");
const SAFE_ID = /^[A-Za-z0-9_-]+$/;

function outputDir(selectionId: string): string {
  if (!SAFE_ID.test(selectionId)) {
    throw new Error(`Unsafe Digital Twin selection id: ${selectionId}`);
  }
  return path.join(ROOT_DIR, selectionId);
}

function outputFile(selectionId: string, profileId: string): string | null {
  if (!SAFE_ID.test(profileId)) return null;
  return path.join(outputDir(selectionId), `${profileId}.json`);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

export async function readDigitalTwinStage1Record(
  selectionId: string,
  profileId: string,
): Promise<DigitalTwinStage1Record | null> {
  const file = outputFile(selectionId, profileId);
  if (!file) return null;

  try {
    return digitalTwinStage1RecordSchema.parse(
      JSON.parse(await readFile(file, "utf8")),
    );
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }
}

export async function listDigitalTwinStage1Records(
  selectionId: string,
): Promise<DigitalTwinStage1Record[]> {
  let entries: string[];
  try {
    entries = await readdir(outputDir(selectionId));
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const records = await Promise.all(
    entries
      .filter((entry) => entry.endsWith(".json"))
      .sort((a, b) => a.localeCompare(b))
      .map((entry) =>
        readDigitalTwinStage1Record(
          selectionId,
          entry.slice(0, -".json".length),
        ),
      ),
  );
  return records.filter(
    (record): record is DigitalTwinStage1Record => record !== null,
  );
}

export async function writeDigitalTwinStage1Record(
  record: DigitalTwinStage1Record,
): Promise<void> {
  const parsed = digitalTwinStage1RecordSchema.parse(record);
  const file = outputFile(parsed.selection_id, parsed.profile_id);
  if (!file) throw new Error(`Unsafe Digital Twin profile id: ${parsed.profile_id}`);

  await mkdir(outputDir(parsed.selection_id), { recursive: true });
  await writeJsonFile(file, parsed);
}

