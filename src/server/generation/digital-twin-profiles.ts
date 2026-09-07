import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import path from "node:path";

import {
  asyncBufferFromFile,
  parquetMetadataAsync,
  parquetReadObjects,
} from "hyparquet";
import { compressors } from "hyparquet-compressors";

import {
  DIGITAL_TWIN_DATASET_NAME,
  type DigitalTwinProfile,
  type DigitalTwinProfileSummary,
} from "@/lib/digital-twin";
import type { RunContext } from "@/server/generation/runs";
import {
  activateDigitalTwinSelection,
  writeDigitalTwinProfile,
} from "@/server/storage/digital-twin-profiles";

const CHUNKS_DIR = path.join(
  process.cwd(),
  "datasets",
  "digital-twin",
  "wave_split",
  "chunks",
);

type ParticipantLocation = {
  participantId: number;
  sourceFile: string;
  sourceRow: number;
};

type PersonaRow = Record<string, unknown> & {
  pid?: unknown;
  wave1_3_persona_text?: unknown;
  wave1_3_persona_json?: unknown;
  wave4_Q_wave1_3_A?: unknown;
};

async function chunkFiles(): Promise<string[]> {
  let entries: string[];
  try {
    entries = await readdir(CHUNKS_DIR);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT") {
      throw new Error(
        `Digital Twin dataset not found at ${CHUNKS_DIR}. Download it before starting Stage 0.`,
      );
    }
    throw error;
  }

  const files = entries
    .filter((entry) => entry.endsWith(".parquet"))
    .sort((a, b) => a.localeCompare(b));

  if (files.length === 0) {
    throw new Error(`No Parquet chunks found at ${CHUNKS_DIR}.`);
  }

  return files;
}

function participantId(value: unknown): number {
  const parsed = typeof value === "bigint" ? Number(value) : Number(value);
  if (!Number.isSafeInteger(parsed) || parsed <= 0) {
    throw new Error(`Invalid participant id in Digital Twin dataset: ${String(value)}`);
  }
  return parsed;
}

async function participantIndex(): Promise<ParticipantLocation[]> {
  const locations: ParticipantLocation[] = [];

  for (const sourceFile of await chunkFiles()) {
    const file = await asyncBufferFromFile(path.join(CHUNKS_DIR, sourceFile));
    const rows = await parquetReadObjects({
      file,
      compressors,
      columns: ["pid"],
    });

    rows.forEach((row, sourceRow) => {
      locations.push({
        participantId: participantId(row.pid),
        sourceFile,
        sourceRow,
      });
    });
  }

  const unique = new Set(locations.map((location) => location.participantId));
  if (unique.size !== locations.length) {
    throw new Error("Digital Twin dataset contains duplicate participant ids.");
  }

  return locations;
}

/** Hash ranking makes a sample deterministic without relying on PRNG versions. */
function selectParticipants(
  locations: ParticipantLocation[],
  count: number,
  seed: string,
): ParticipantLocation[] {
  return locations
    .map((location) => ({
      location,
      rank: createHash("sha256")
        .update(`${seed}:${location.participantId}`)
        .digest("hex"),
    }))
    .sort((a, b) =>
      a.rank === b.rank
        ? a.location.participantId - b.location.participantId
        : a.rank.localeCompare(b.rank),
    )
    .slice(0, count)
    .map(({ location }) => location);
}

export async function digitalTwinDatasetSize(): Promise<number> {
  let total = 0;
  for (const sourceFile of await chunkFiles()) {
    const file = await asyncBufferFromFile(path.join(CHUNKS_DIR, sourceFile));
    const metadata = await parquetMetadataAsync(file);
    total += Number(metadata.num_rows);
  }
  return total;
}

export async function readDigitalTwinAssignedEvaluationBlock(
  profile: Pick<
    DigitalTwinProfile,
    | "participant_id"
    | "source_file"
    | "source_row"
    | "wave4_Q_wave1_3_A"
  >,
): Promise<string> {
  if (profile.wave4_Q_wave1_3_A) return profile.wave4_Q_wave1_3_A;
  if (path.basename(profile.source_file) !== profile.source_file) {
    throw new Error(`Unsafe Digital Twin source file: ${profile.source_file}`);
  }

  const file = await asyncBufferFromFile(
    path.join(CHUNKS_DIR, profile.source_file),
  );
  const rows = (await parquetReadObjects({
    file,
    compressors,
    columns: ["pid", "wave4_Q_wave1_3_A"],
  })) as PersonaRow[];
  const row = rows[profile.source_row];
  const pid = participantId(row?.pid);
  const block = row?.wave4_Q_wave1_3_A;
  if (pid !== profile.participant_id || typeof block !== "string") {
    throw new Error(
      `Malformed assigned evaluation block for participant ${profile.participant_id} in ${profile.source_file}.`,
    );
  }
  return block;
}

export async function importDigitalTwinProfiles({
  count,
  run,
}: {
  count: number;
  run: RunContext;
}): Promise<{ selectionId: string; seed: string }> {
  const locations = await participantIndex();
  if (count > locations.length) {
    throw new Error(
      `Requested ${count} personas, but the dataset contains ${locations.length}.`,
    );
  }

  const seed = randomBytes(16).toString("hex");
  const selectionId = `selection_${Date.now().toString(36)}_${seed.slice(0, 8)}`;
  const selectedAt = new Date().toISOString();
  const selected = selectParticipants(locations, count, seed);
  const selectedByFile = new Map<string, Map<number, ParticipantLocation>>();

  for (const location of selected) {
    const rows = selectedByFile.get(location.sourceFile) ?? new Map();
    rows.set(location.sourceRow, location);
    selectedByFile.set(location.sourceFile, rows);
  }

  run.setTotal(count);
  const summaries = new Map<number, DigitalTwinProfileSummary>();

  for (const [sourceFile, wantedRows] of selectedByFile) {
    if (run.signal.aborted) throw new Error("Digital Twin import cancelled.");

    const file = await asyncBufferFromFile(path.join(CHUNKS_DIR, sourceFile));
    const rows = (await parquetReadObjects({
      file,
      compressors,
      columns: [
        "pid",
        "wave1_3_persona_text",
        "wave1_3_persona_json",
        "wave4_Q_wave1_3_A",
      ],
    })) as PersonaRow[];

    for (const [sourceRow, location] of wantedRows) {
      if (run.signal.aborted) throw new Error("Digital Twin import cancelled.");

      const row = rows[sourceRow];
      const text = row?.wave1_3_persona_text;
      const json = row?.wave1_3_persona_json;
      const assignedEvaluationBlock = row?.wave4_Q_wave1_3_A;
      const pid = participantId(row?.pid);

      if (
        pid !== location.participantId ||
        typeof text !== "string" ||
        typeof json !== "string" ||
        typeof assignedEvaluationBlock !== "string"
      ) {
        throw new Error(
          `Malformed persona row for participant ${location.participantId} in ${sourceFile}.`,
        );
      }

      const id = `twin_${String(pid).padStart(4, "0")}`;
      const summary: DigitalTwinProfileSummary = {
        id,
        participant_id: pid,
        source_file: sourceFile,
        source_row: sourceRow,
        persona_text_characters: text.length,
        persona_json_characters: json.length,
      };
      const profile: DigitalTwinProfile = {
        ...summary,
        dataset: DIGITAL_TWIN_DATASET_NAME,
        selection_id: selectionId,
        selection_seed: seed,
        selected_at: selectedAt,
        wave1_3_persona_text: text,
        wave1_3_persona_json: json,
        wave4_Q_wave1_3_A: assignedEvaluationBlock,
      };

      await writeDigitalTwinProfile(profile);
      summaries.set(pid, summary);
      run.itemDone();
    }
  }

  const orderedSummaries = selected.map((location) => {
    const summary = summaries.get(location.participantId);
    if (!summary) {
      throw new Error(`Participant ${location.participantId} was selected but not imported.`);
    }
    return summary;
  });

  await activateDigitalTwinSelection({
    id: selectionId,
    dataset: DIGITAL_TWIN_DATASET_NAME,
    seed,
    selection_method: "seeded-random",
    requested_count: count,
    selected_count: orderedSummaries.length,
    total_available: locations.length,
    created_at: selectedAt,
    profiles: orderedSummaries,
  });

  return { selectionId, seed };
}
