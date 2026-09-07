import "server-only";

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";

import type {
  DigitalTwinEvaluationView,
  DigitalTwinMethodScore,
  DigitalTwinStage4Report,
  DigitalTwinTaskScore,
} from "@/lib/digital-twin-stage-4";
import {
  DIGITAL_TWIN_INPUT_ADAPTER_VERSION,
  type DigitalTwinTargetQuestion,
} from "@/lib/digital-twin-stage-2";
import { FLOWS } from "@/server/flows";
import { DIGITAL_TWIN_TASKS } from "@/server/generation/digital-twin-stage-2";
import { listDigitalTwinEpisodeRefs, readDigitalTwinEpisode } from "@/server/storage/digital-twin-stage-2";
import { listAllDigitalTwinExecutions } from "@/server/storage/digital-twin-stage-3";

const DATA_DIR = path.join(process.cwd(), "datasets", "digital-twin", "question_catalog");
const CACHE_DIR = path.join(process.cwd(), "data", "digital-twins", "stage-4", "cache");
const BASELINE_FILE = path.join(CACHE_DIR, "published-gpt-4.1-mini.csv");
// The official MAD evaluator scores the four numeric anchoring estimates after
// decile conversion. The preceding binary high/low anchor checks are presented
// to participants, but are deliberately absent from its scoring ranges.
const OFFICIAL_UNSCORED_COLUMNS = new Set([
  "QID163",
  "QID165",
  "QID167",
  "QID169",
]);
export const PUBLISHED_REVISION = "f883165a3026fde855dfd448e0cd16443ab257b6";
export const PUBLISHED_RESULTS_URL =
  `https://huggingface.co/datasets/LLM-Digital-Twin/Twin-2K-500/resolve/${PUBLISHED_REVISION}/` +
  "LLM_simulation_results/GPT4.1-mini-simulation-llm-vs-human/responses_llm_imputed_formatted.csv";

type CsvRow = Record<string, string>;
type AnswerScore = { taskKey: string; value: number; exact: boolean };
type MethodAnswers = Map<number, Map<string, Record<string, number>>>;

function parseCsv(text: string, skipRows = 0): CsvRow[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quoted) {
      if (char === '"' && text[index + 1] === '"') {
        field += '"';
        index++;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  const header = rows[0]?.map((value, index) =>
    index === 0 ? value.replace(/^\uFEFF/, "") : value,
  );
  if (!header) return [];
  return rows.slice(1 + skipRows).filter((values) => values.some(Boolean)).map((values) =>
    Object.fromEntries(header.map((key, index) => [key, values[index] ?? ""])),
  );
}

async function readLocalCsv(name: string): Promise<CsvRow[]> {
  return parseCsv(await readFile(path.join(DATA_DIR, name), "utf8"));
}

function dispatcher(): Dispatcher | undefined {
  const proxy = process.env.OPENROUTER_PROXY_URL;
  return proxy ? new ProxyAgent(proxy) : undefined;
}

async function publishedCsv(): Promise<string> {
  try {
    return await readFile(BASELINE_FILE, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const response = await undiciFetch(PUBLISHED_RESULTS_URL, {
    dispatcher: dispatcher(),
    headers: { "User-Agent": "InnerUniverse-Digital-Twin-Evaluation" },
  });
  if (!response.ok) throw new Error(`Hugging Face returned ${response.status} ${response.statusText}.`);
  const text = await response.text();
  await mkdir(CACHE_DIR, { recursive: true });
  const temporary = `${BASELINE_FILE}.${process.pid}.tmp`;
  await writeFile(temporary, text, "utf8");
  await rename(temporary, BASELINE_FILE);
  return text;
}

function number(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || value.trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function list(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function numericRange(question: DigitalTwinTargetQuestion, column: string): number {
  if (["QID164_TEXT", "QID166_TEXT", "QID168_TEXT", "QID170_TEXT"].includes(column)) return 9;
  if (["QID181_TEXT", "QID182_TEXT"].includes(column)) return 20;
  if (question.QuestionType === "MC") return Math.max(1, list(question.Options).length - 1);
  if (question.QuestionType === "Matrix") return Math.max(1, list(question.Columns).length - 1);
  if (question.QuestionType === "Slider") {
    const range = question.Range as { Min?: unknown; Max?: unknown } | undefined;
    const min = number(range?.Min);
    const max = number(range?.Max);
    if (min !== null && max !== null && max > min) return max - min;
  }
  throw new Error(`No evaluation range for ${column} (${question.QuestionType}).`);
}

function percentile(sorted: number[], fraction: number): number {
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  const upper = Math.ceil(position);
  if (lower === upper) return sorted[lower];
  return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
}

function thresholds(rows: CsvRow[], columns: string[]): number[] {
  const values = rows.flatMap((row) => columns.map((column) => number(row[column])).filter((value): value is number => value !== null)).sort((a, b) => a - b);
  if (values.length === 0) throw new Error(`No Wave 1–3 values for ${columns.join(", ")}.`);
  return Array.from({ length: 9 }, (_, index) => percentile(values, (index + 1) / 10));
}

function decile(value: number, cutoffs: number[]): number {
  const index = cutoffs.findIndex((cutoff) => value <= cutoff);
  return index === -1 ? 10 : index + 1;
}

function publishedColumn(column: string): string {
  if (column === "QID154") return "Form A _1";
  if (column === "QID156") return "Q156_1";
  if (column.startsWith("QID9_")) return `${column.slice(5)}_Q295`;
  if (column.startsWith("QID287_")) {
    const id = Number(column.split("_")[1]);
    const position = id <= 7 ? id : id - 2;
    return `False Cons. self _${position}`;
  }
  if (column.startsWith("QID290_")) return `False cons. others _${column.split("_")[1]}`;
  if (column.startsWith("QID288_")) return `nonseparabilty bene _${column.split("_")[1]}`;
  if (column.startsWith("QID289_")) return `nonseparability ris _${column.split("_")[1]}`;
  if (column === "QID291") return "Omission bias ";
  if (column === "QID196") return "Denominator neglect ";
  return column.replace(/^QID/, "Q").replace(/_TEXT$/, "");
}

function normalizedRow(row: CsvRow): CsvRow {
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value]));
}

function summarize(key: string, label: string, kind: DigitalTwinMethodScore["kind"], scores: Map<number, AnswerScore[]>): DigitalTwinMethodScore {
  const participantMeans: number[] = [];
  let exact = 0;
  let comparedAnswers = 0;
  const tasks = new Set<string>();
  for (const entries of scores.values()) {
    const byTask = new Map<string, AnswerScore[]>();
    for (const entry of entries) {
      const group = byTask.get(entry.taskKey) ?? [];
      group.push(entry);
      byTask.set(entry.taskKey, group);
      exact += entry.exact ? 1 : 0;
      comparedAnswers++;
      tasks.add(entry.taskKey);
    }
    const taskMeans = [...byTask.values()].map((items) => items.reduce((sum, item) => sum + item.value, 0) / items.length);
    if (taskMeans.length) participantMeans.push(taskMeans.reduce((sum, value) => sum + value, 0) / taskMeans.length);
  }
  return {
    key, label, kind,
    accuracy: participantMeans.length ? participantMeans.reduce((sum, value) => sum + value, 0) / participantMeans.length : null,
    exactMatch: comparedAnswers ? exact / comparedAnswers : null,
    comparedAnswers,
    participants: participantMeans.length,
    tasks: tasks.size,
  };
}

function scoreMethod({ predictions, truth, questionByColumn, taskByColumn, anchorCutoffs }: {
  predictions: MethodAnswers;
  truth: Map<number, CsvRow>;
  questionByColumn: Map<string, DigitalTwinTargetQuestion>;
  taskByColumn: Map<string, string>;
  anchorCutoffs: Record<string, number[]>;
}): Map<number, AnswerScore[]> {
  const result = new Map<number, AnswerScore[]>();
  for (const [participantId, tasks] of predictions) {
    const truthRow = truth.get(participantId);
    if (!truthRow) continue;
    const scores: AnswerScore[] = [];
    for (const [taskKey, answers] of tasks) {
      for (const [column, predictedRaw] of Object.entries(answers)) {
        const actualRaw = number(truthRow[column]);
        const question = questionByColumn.get(column);
        if (actualRaw === null || !question) continue;
        const cutoffs = anchorCutoffs[column];
        const predicted = cutoffs ? decile(predictedRaw, cutoffs) : predictedRaw;
        const actual = cutoffs ? decile(actualRaw, cutoffs) : actualRaw;
        const value = 1 - Math.abs(predicted - actual) / numericRange(question, column);
        scores.push({
          taskKey: taskByColumn.get(column) ?? taskKey,
          value,
          // Exact match remains literal even where the original MAD method
          // decile-normalizes anchoring responses for its graded score.
          exact: predictedRaw === actualRaw,
        });
      }
    }
    if (scores.length) result.set(participantId, scores);
  }
  return result;
}

function taskScores(methodScores: Map<string, Map<number, AnswerScore[]>>, labels: Map<string, string>): DigitalTwinTaskScore[] {
  return DIGITAL_TWIN_TASKS.map((task) => ({
    taskKey: task.key,
    taskLabel: labels.get(task.key) ?? task.label,
    methods: Object.fromEntries([...methodScores].map(([method, participants]) => {
      const entries = [...participants.values()].flat().filter((entry) => entry.taskKey === task.key);
      return [method, {
        accuracy: entries.length ? entries.reduce((sum, entry) => sum + entry.value, 0) / entries.length : null,
        exactMatch: entries.length ? entries.filter((entry) => entry.exact).length / entries.length : null,
        comparedAnswers: entries.length,
      }];
    })),
  }));
}

function heldOutAnswerCount(
  truth: Map<number, CsvRow>,
  questionByColumn: Map<string, DigitalTwinTargetQuestion>,
): number {
  return [...truth.values()].reduce(
    (count, row) =>
      count +
      [...questionByColumn.keys()].filter(
        (column) => number(row[column]) !== null,
      ).length,
    0,
  );
}

function evaluationView({
  key,
  label,
  description,
  truth,
  predictionsByMethod,
  questionByColumn,
  taskByColumn,
  taskLabels,
  anchorCutoffs,
}: {
  key: DigitalTwinEvaluationView["key"];
  label: string;
  description: string;
  truth: Map<number, CsvRow>;
  predictionsByMethod: Map<string, MethodAnswers>;
  questionByColumn: Map<string, DigitalTwinTargetQuestion>;
  taskByColumn: Map<string, string>;
  taskLabels: Map<string, string>;
  anchorCutoffs: Record<string, number[]>;
}): DigitalTwinEvaluationView {
  const scored = new Map<string, Map<number, AnswerScore[]>>();
  for (const [method, predictions] of predictionsByMethod) {
    scored.set(
      method,
      scoreMethod({
        predictions,
        truth,
        questionByColumn,
        taskByColumn,
        anchorCutoffs,
      }),
    );
  }
  return {
    key,
    label,
    description,
    groundTruth: key,
    heldOutAnswers: heldOutAnswerCount(truth, questionByColumn),
    methods: [
      ...FLOWS.map((flow) =>
        summarize(
          flow.key,
          flow.label,
          "dataset-testing",
          scored.get(flow.key) ?? new Map(),
        ),
      ),
      summarize(
        "digital_twin_simulation",
        "Digital-Twin-Simulation (published GPT-4.1-mini)",
        "published-baseline",
        scored.get("digital_twin_simulation") ?? new Map(),
      ),
    ],
    tasks: taskScores(scored, taskLabels),
  };
}

export async function buildDigitalTwinStage4Report(selectionId: string): Promise<DigitalTwinStage4Report> {
  const [wave1Rows, wave4Rows, refs, executions] = await Promise.all([
    readLocalCsv("wave1_3_response.csv"),
    readLocalCsv("wave4_response.csv"),
    listDigitalTwinEpisodeRefs(selectionId),
    listAllDigitalTwinExecutions(selectionId),
  ]);
  const episodes = (
    await Promise.all(
      refs.map((ref) =>
        readDigitalTwinEpisode(selectionId, ref.profileId, ref.episodeId),
      ),
    )
  ).filter(
    (episode): episode is NonNullable<typeof episode> =>
      episode !== null &&
      episode.input_adapter_version === DIGITAL_TWIN_INPUT_ADAPTER_VERSION,
  );
  const questionByColumn = new Map<string, DigitalTwinTargetQuestion>();
  const taskByColumn = new Map<string, string>();
  const taskLabels = new Map<string, string>();
  for (const episode of episodes) {
    taskLabels.set(episode.task_key, episode.task_label);
    for (const question of episode.questions) for (const column of question.csv_columns) {
      if (OFFICIAL_UNSCORED_COLUMNS.has(column)) continue;
      questionByColumn.set(column, question);
      taskByColumn.set(column, episode.task_key);
    }
  }
  const episodeByExecution = new Map(
    episodes.map((episode) => [
      `${episode.profile_id}/${episode.id}`,
      episode,
    ]),
  );
  const selectedIds = new Set(episodes.map((episode) => episode.participant_id));
  const wave1Truth = new Map(wave1Rows.map((row) => [Number(row.pid), row]).filter(([pid]) => selectedIds.has(pid as number)) as [number, CsvRow][]);
  const wave4Truth = new Map(wave4Rows.map((row) => [Number(row.pid), row]).filter(([pid]) => selectedIds.has(pid as number)) as [number, CsvRow][]);
  // Match the official evaluator: filter to the evaluated respondents before
  // deriving the Wave 1-3 anchoring deciles.
  const evaluatedWave1Rows = [...wave1Truth.values()];
  const anchorCutoffs: Record<string, number[]> = {};
  if (evaluatedWave1Rows.length > 0) {
    const anchor164 = thresholds(evaluatedWave1Rows, ["QID164_TEXT", "QID166_TEXT"]);
    const anchor168 = thresholds(evaluatedWave1Rows, ["QID168_TEXT", "QID170_TEXT"]);
    Object.assign(anchorCutoffs, {
      QID164_TEXT: anchor164,
      QID166_TEXT: anchor164,
      QID168_TEXT: anchor168,
      QID170_TEXT: anchor168,
    });
  }

  const predictionsByMethod = new Map<string, MethodAnswers>();
  for (const execution of executions) {
    if (!execution.answers) continue;
    const episode = episodeByExecution.get(
      `${execution.profile_id}/${execution.episode_id}`,
    );
    if (
      !episode ||
      execution.stage1_generated_at !== episode.stage1_generated_at ||
      execution.episode_generated_at !== episode.generated_at
    ) {
      continue;
    }
    const method = predictionsByMethod.get(execution.flow_key) ?? new Map();
    const participant = method.get(execution.participant_id) ?? new Map();
    participant.set(execution.task_key, Object.fromEntries(Object.entries(execution.answers).map(([key, value]) => [key, Number(value)])));
    method.set(execution.participant_id, participant);
    predictionsByMethod.set(execution.flow_key, method);
  }

  let baselineError: string | null = null;
  try {
    const rows = parseCsv(await publishedCsv(), 1);
    const publishedHeaders = new Set(
      Object.keys(rows[0] ?? {}).map((key) => key.trim().toLowerCase()),
    );
    const unmapped = [...questionByColumn.keys()].filter(
      (column) =>
        !publishedHeaders.has(publishedColumn(column).trim().toLowerCase()),
    );
    if (unmapped.length > 0) {
      throw new Error(
        `Published results are missing ${unmapped.length} expected columns: ${unmapped.join(", ")}.`,
      );
    }
    const baseline: MethodAnswers = new Map();
    for (const rawRow of rows) {
      const row = normalizedRow(rawRow);
      const participantId = Number(row.twin_id);
      if (!selectedIds.has(participantId)) continue;
      const byTask = new Map<string, Record<string, number>>();
      for (const column of questionByColumn.keys()) {
        const value = number(row[publishedColumn(column).trim().toLowerCase()]);
        if (value === null) continue;
        const taskKey = taskByColumn.get(column)!;
        byTask.set(taskKey, { ...(byTask.get(taskKey) ?? {}), [column]: value });
      }
      baseline.set(participantId, byTask);
    }
    predictionsByMethod.set("digital_twin_simulation", baseline);
  } catch (error) {
    baselineError = error instanceof Error ? error.message : String(error);
  }

  return {
    selectionId,
    selectedParticipants: selectedIds.size,
    evaluations: [
      evaluationView({
        key: "wave4",
        label: "Wave 4 prediction",
        description:
          "Primary experiment: both methods are rescored against the same later Wave 4 responses.",
        truth: wave4Truth,
        predictionsByMethod,
        questionByColumn,
        taskByColumn,
        taskLabels,
        anchorCutoffs,
      }),
      evaluationView({
        key: "wave1_3",
        label: "Paper-compatible holdout",
        description:
          "Compatibility view: both methods are scored against the Wave 1–3 held-out responses used as ground truth in the published paper.",
        truth: wave1Truth,
        predictionsByMethod,
        questionByColumn,
        taskByColumn,
        taskLabels,
        anchorCutoffs,
      }),
    ],
    baseline: { available: baselineError === null, sourceUrl: PUBLISHED_RESULTS_URL, revision: PUBLISHED_REVISION, error: baselineError },
  };
}
