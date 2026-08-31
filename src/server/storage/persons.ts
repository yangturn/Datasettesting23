import "server-only";

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { personSchema, type Person } from "@/lib/person";

/**
 * Persons live as one JSON file per person under `data/persons/`.
 * No database — files are the source of truth and stay diffable by hand.
 */
const PERSONS_DIR = path.join(process.cwd(), "data", "persons");

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

/** Guards against `personId` escaping the persons directory. */
function personFilePath(personId: string): string | null {
  if (!/^[A-Za-z0-9_-]+$/.test(personId)) return null;
  return path.join(PERSONS_DIR, `${personId}.json`);
}

export async function readPerson(personId: string): Promise<Person | null> {
  const filePath = personFilePath(personId);
  if (!filePath) return null;

  let raw: string;
  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNotFound(error)) return null;
    throw error;
  }

  // Parse strictly — a malformed person file should fail loudly, not render blank.
  return personSchema.parse(JSON.parse(raw));
}

export async function listPersons(): Promise<Person[]> {
  let entries: string[];
  try {
    entries = await readdir(PERSONS_DIR);
  } catch (error) {
    if (isNotFound(error)) return [];
    throw error;
  }

  const ids = entries
    .filter((entry) => entry.endsWith(".json"))
    .map((entry) => entry.slice(0, -".json".length))
    .sort((a, b) => a.localeCompare(b));

  const persons = await Promise.all(ids.map((id) => readPerson(id)));
  return persons.filter((person): person is Person => person !== null);
}
