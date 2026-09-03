import "server-only";

import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvConfig } from "@next/env";
import { z } from "zod";

import type { Description } from "@/lib/stage-1";
import type { Scenario } from "@/lib/stage-2";
import { fullFlowFirstPersonFlow } from "@/server/flows/full-flow-first-person";
import { STEP_REAPPRAISAL, fullFlow } from "@/server/flows/full-flow";
import { IMMEDIATE_STEPS } from "@/server/flows/immediate-flow";
import {
  STEP_APPRAISAL,
  STEP_ATTRIBUTES,
  STEP_CONSOLIDATE,
  STEP_DECISION,
  priorStepBlock,
} from "@/server/flows/shared";
import {
  stepSchema,
  type Flow,
  type FlowStep,
  type StepInput,
} from "@/server/flows/types";
import { configuredModel, generateJson } from "@/server/llm/openrouter";

const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(SCRIPT_DIR, "..");
const DATASET_DIR = path.join(REPO_ROOT, "datasets", "behaviorchain");
const CACHE_DIR = path.join(REPO_ROOT, ".cache", "behaviorchain");
const PROFILE_CACHE_DIR = path.join(CACHE_DIR, "profiles");
const EXECUTION_CACHE_DIR = path.join(CACHE_DIR, "executions");
const REPORT_DIR = path.join(CACHE_DIR, "reports");

const SAMPLE_SEED = 42;
const CONTEXT_FIELD = "new_summary" as const;
const PROFILE_PROMPT_VERSION = 1;
const EVALUATION_VERSION = 2;
const DEFAULT_REQUEST_CONCURRENCY = 24;
const TRANSIENT_REQUEST_ATTEMPTS = 6;
const REQUEST_TIMEOUT_MS = 120_000;
const EVENT_PREFIX = "@@BEHAVIORCHAIN@@";

const FLOW_SET_KEYS = [
  "immediate-full",
  "first-person",
  "first-person-head-only",
] as const;
type FlowSetKey = (typeof FLOW_SET_KEYS)[number];

const OPTION_KEYS = ["a", "b", "c", "d"] as const;
const optionKeySchema = z.enum(OPTION_KEYS);
type OptionKey = z.infer<typeof optionKeySchema>;

type ProgressEvent = {
  type: "progress";
  units: number;
  cached: boolean;
};

function emitEvent(event: Record<string, unknown>): void {
  process.stdout.write(`${EVENT_PREFIX}${JSON.stringify(event)}\n`);
}

const optionsSchema = z.object({
  a: z.string().min(1),
  b: z.string().min(1),
  c: z.string().min(1),
  d: z.string().min(1),
});

const chapterSchema = z.object({
  chapter_num: z.string().optional(),
  chapter_num_int: z.number().int().optional(),
  chapter_content: z.string().min(1),
});

const exampleSchema = z
  .object({
    key_behavior: z.string().optional(),
    new_summary: z.string().optional(),
    summary_refined: z.string().optional(),
    right_option_index: optionKeySchema.optional().catch(undefined),
    options_out_of_order: optionsSchema.optional().catch(undefined),
  })
  .passthrough();

const behaviorChainFileSchema = z.object({
  title: z.string().min(1),
  author: z.string().min(1),
  profile: z.record(z.string(), z.unknown()),
  representative_name: z.string().min(1),
  summary: z.array(chapterSchema).min(1),
  examples: z.array(exampleSchema).min(1),
});

type BehaviorChainFile = z.infer<typeof behaviorChainFileSchema>;
type BehaviorExample = z.infer<typeof exampleSchema>;

const convertedProfileSchema = z.object({
  name: z.string().min(1),
  headline: z.string().min(1),
  description: z.string().min(1),
});
type ConvertedProfile = z.infer<typeof convertedProfileSchema>;

type GenerateJsonRequest<T extends z.ZodType> = {
  schema: T;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  model?: string;
};

/**
 * One global limiter for the entire benchmark. Work from different characters,
 * flows, and examples shares the same pool, so a short chain or cached stage
 * cannot strand most of the available OpenRouter capacity.
 */
export class RequestPool {
  private active = 0;
  private readonly queue: (() => void)[] = [];
  peak = 0;

  constructor(readonly limit: number) {
    if (!Number.isInteger(limit) || limit < 1) {
      throw new Error("RequestPool limit must be a positive integer.");
    }
  }

  async run<T>(task: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.queue.shift()?.();
    }
  }

  private acquire(): Promise<void> {
    if (this.active < this.limit) {
      this.active += 1;
      this.peak = Math.max(this.peak, this.active);
      return Promise.resolve();
    }

    return new Promise((resolve) => {
      this.queue.push(() => {
        this.active += 1;
        this.peak = Math.max(this.peak, this.active);
        resolve();
      });
    });
  }
}

function errorChainText(error: unknown): string {
  const messages: string[] = [];
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth += 1) {
    if (current instanceof Error) {
      messages.push(current.message);
      current = current.cause;
    } else {
      messages.push(String(current));
      break;
    }
  }
  return messages.join(" | ");
}

function isTransientRequestError(error: unknown): boolean {
  const message = errorChainText(error);
  return (
    /OpenRouter (?:408|409|425|429|5\d\d)\b/i.test(message) ||
    /request failed before receiving an HTTP response/i.test(message) ||
    /(?:ECONNRESET|ECONNREFUSED|ENETUNREACH|EAI_AGAIN|ETIMEDOUT|UND_ERR_[A-Z_]+)/i.test(
      message,
    ) ||
    /(?:rate.?limit|temporar(?:y|ily)|overload|unavailable|timed? out|aborted)/i.test(
      message,
    )
  );
}

function wait(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function generateWithRetry<T extends z.ZodType>(
  pool: RequestPool,
  request: GenerateJsonRequest<T>,
): Promise<z.infer<T>> {
  let lastError: unknown;

  for (let attempt = 0; attempt < TRANSIENT_REQUEST_ATTEMPTS; attempt += 1) {
    try {
      return await pool.run(async () => {
        const controller = new AbortController();
        const timeout = setTimeout(
          () =>
            controller.abort(
              new Error(
                `OpenRouter request timed out after ${REQUEST_TIMEOUT_MS / 1_000} seconds.`,
              ),
            ),
          REQUEST_TIMEOUT_MS,
        );
        const forwardAbort = (): void =>
          controller.abort(request.signal?.reason);
        request.signal?.addEventListener("abort", forwardAbort, { once: true });
        if (request.signal?.aborted) forwardAbort();

        try {
          return await generateJson({ ...request, signal: controller.signal });
        } finally {
          clearTimeout(timeout);
          request.signal?.removeEventListener("abort", forwardAbort);
        }
      });
    } catch (error) {
      lastError = error;
      if (
        !isTransientRequestError(error) ||
        attempt === TRANSIENT_REQUEST_ATTEMPTS - 1
      ) {
        throw error;
      }

      // The pool slot has already been released. Jitter prevents every request
      // throttled in the same burst from retrying at exactly the same instant.
      const delay =
        Math.min(30_000, 1_000 * 2 ** attempt) +
        Math.floor(Math.random() * 500);
      emitEvent({
        type: "retry",
        message:
          `Transient OpenRouter failure; retrying in ${(delay / 1_000).toFixed(1)}s ` +
          `(${attempt + 2}/${TRANSIENT_REQUEST_ATTEMPTS}).`,
      });
      await wait(delay);
    }
  }

  throw lastError;
}

const profileCacheSchema = z.object({
  version: z.literal(PROFILE_PROMPT_VERSION),
  source_hash: z.string(),
  model: z.string(),
  generated_at: z.string(),
  profile: convertedProfileSchema,
});

const cachedStepSchema = z.object({
  output: z.record(z.string(), z.string()),
  generated_at: z.string(),
  model: z.string(),
});

const executionCacheSchema = z.object({
  version: z.literal(EVALUATION_VERSION),
  input_hash: z.string(),
  flow: z.string(),
  model: z.string(),
  steps: z.record(z.string(), cachedStepSchema),
});
type ExecutionCache = z.infer<typeof executionCacheSchema>;

const choiceSchema = z.object({ choice: optionKeySchema });

const MULTIPLE_CHOICE_SYSTEM = `You answer a multiple-choice behavioral-prediction question using the character reasoning already produced by the pipeline.

Choose the single option that best matches what the character did after or in response to the situation represented in the pipeline analysis. Treat the supplied analysis and answer options as canonical. Do not invent a fifth behavior. Return exactly one JSON object with no explanation or additional prose.`;

function optionsFrom(input: StepInput): z.infer<typeof optionsSchema> {
  const raw = input.scenario.context.behaviorchain_options;
  if (!raw)
    throw new Error("BehaviorChain options are missing from the scenario.");
  return optionsSchema.parse(JSON.parse(raw));
}

function formatOptions(options: z.infer<typeof optionsSchema>): string {
  return OPTION_KEYS.map((key) => `${key}) ${options[key]}`).join("\n");
}

function makeChoiceStep(decisionInputs: FlowStep[]): FlowStep {
  return {
    key: STEP_DECISION,
    label: "BehaviorChain multiple-choice decision",
    description:
      "Replaces free action generation with an exact a/b/c/d benchmark choice.",
    requiresContext: ["behaviorchain_options"],
    fields: [
      { key: "choice", label: "Choice", render: "value", values: OPTION_KEYS },
    ],
    system: MULTIPLE_CHOICE_SYSTEM,
    buildPrompt(input) {
      const reasoning = decisionInputs
        .map((step) => `${step.label}:\n\n${priorStepBlock(input, step)}`)
        .join("\n\n");
      return `Pipeline analysis available to the normal decision stage:\n\n${reasoning}\n\nAnswer options:\n${formatOptions(optionsFrom(input))}\n\nChoose the single option that best matches the character's behavior. Return JSON only:\n\n{\n  "choice": "a"\n}`;
    },
  };
}

const OPTION_CONDITIONING_GUIDANCE: Record<string, string> = {
  [STEP_ATTRIBUTES]:
    "Use the distinctions among the candidate behaviors only to focus extraction on decision-relevant evidence. Derive attributes from the supplied biography and context, never from assumptions suggested by an option. Do not choose, rank, score, or eliminate options in this stage.",
  [STEP_CONSOLIDATE]:
    "Preserve the supplied evidence that will later distinguish among the candidate behaviors, while still producing the same coherent pre-appraisal context. Do not choose, rank, score, or eliminate options in this stage.",
  [STEP_APPRAISAL]:
    "Treat the candidates as the externally available response set, but preserve fast first-person appraisal: Do not systematically compare options, output an option letter, or make a final choice. The initial action tendency should arise naturally from the character's appraisal and may point toward a candidate behavior.",
  [STEP_REAPPRAISAL]:
    "The four candidates are the response alternatives available for deliberate reflection. Compare only the relevant candidates through the character's first-person perspective. Do not output an option letter or make the final choice; express the result through the existing revised action tendency.",
};

/**
 * Makes an existing psychological stage aware of the fixed MCQ objective while
 * preserving its key, fields, voice, and place in the five-call method.
 */
function optionConditionedStep(step: FlowStep): FlowStep {
  const guidance = OPTION_CONDITIONING_GUIDANCE[step.key];
  if (!guidance) {
    throw new Error(`No MCQ-conditioning guidance for step ${step.key}.`);
  }

  return {
    ...step,
    requiresContext: [
      ...new Set([...step.requiresContext, "behaviorchain_options"]),
    ],
    system: `${step.system}\n\nMULTIPLE-CHOICE OBJECTIVE\nThe pipeline must ultimately select one of four supplied candidate behaviors. The candidates are visible from the beginning so each reasoning stage remains relevant to the actual decision task. Preserve this stage's existing psychological function and output schema.\n\n${guidance}`,
    buildPrompt(input) {
      return `MULTIPLE-CHOICE BEHAVIORAL OBJECTIVE\n\nThe pipeline must ultimately select exactly one of these candidate behaviors:\n\n${formatOptions(optionsFrom(input))}\n\nStage-specific instruction:\n${guidance}\n\n${step.buildPrompt(input)}`;
    },
  };
}

function behaviorChainFlow(source: Flow): Flow {
  const upstream = source.steps.slice(0, -1);
  // Attribute extraction feeds consolidation, but the normal decision call does
  // not receive that raw intermediate output directly. Preserve that boundary.
  const decisionInputs = upstream.slice(1);
  return {
    ...source,
    key: `${source.key}_behaviorchain`,
    label: `${source.label} — BehaviorChain MCQ`,
    steps: [...upstream, makeChoiceStep(decisionInputs)],
    outcome: { stepKey: STEP_DECISION, fieldKey: "choice" },
  };
}

function optionConditionedBehaviorChainFlow(source: Flow): Flow {
  const upstream = source.steps.slice(0, -1).map(optionConditionedStep);
  const decisionInputs = upstream.slice(1);
  return {
    ...source,
    key: `${source.key}_mcq_behaviorchain`,
    label: `${source.label} — MCQ-conditioned BehaviorChain`,
    description:
      "The same first-person psychological pipeline, with the fixed candidate behaviors supplied to every stage from attribute extraction through final choice.",
    steps: [...upstream, makeChoiceStep(decisionInputs)],
    stepsFor: undefined,
    outcome: { stepKey: STEP_DECISION, fieldKey: "choice" },
  };
}

// The application no longer exposes Immediate Flow as a first-class arm, but
// the original BehaviorChain experiment still does. Reassemble the same flow
// around its shared pipeline so the existing command and cache keys remain
// unchanged after the application architecture update.
const immediateFlow: Flow = {
  key: "immediate_flow",
  label: "Immediate Flow",
  description:
    "The same model without reflection: extract, consolidate, appraise fast, then act. Reflective memories are withheld throughout, and there is no deliberate reappraisal.",
  steps: IMMEDIATE_STEPS,
  outcome: {
    stepKey: STEP_DECISION,
    fieldKey: "action",
    reasonKey: "explanation",
  },
};

export const behaviorChainFlows = [
  behaviorChainFlow(immediateFlow),
  behaviorChainFlow(fullFlow),
];

export const firstPersonBehaviorChainFlows = [
  optionConditionedBehaviorChainFlow(fullFlowFirstPersonFlow),
];

export const firstPersonHeadOnlyBehaviorChainFlows = [
  behaviorChainFlow(fullFlowFirstPersonFlow),
];

function flowsFor(flowSet: FlowSetKey): Flow[] {
  if (flowSet === "first-person") return firstPersonBehaviorChainFlows;
  if (flowSet === "first-person-head-only") {
    return firstPersonHeadOnlyBehaviorChainFlows;
  }
  return behaviorChainFlows;
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableStringify(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function hash(value: unknown): string {
  return createHash("sha256").update(stableStringify(value)).digest("hex");
}

function safeStem(relativePath: string): string {
  const digest = createHash("sha256")
    .update(relativePath)
    .digest("hex")
    .slice(0, 12);
  const readable = path
    .basename(relativePath, ".json")
    .replace(/^finally_examples_/, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .slice(0, 80);
  return `${readable}-${digest}`;
}

async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, "utf8"));
}

async function readJsonIfPresent(file: string): Promise<unknown | undefined> {
  try {
    return await readJson(file);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

async function writeJsonAtomic(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporary, file);
}

async function listJsonFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const target = path.join(directory, entry.name);
      if (entry.isDirectory()) return listJsonFiles(target);
      return entry.isFile() && entry.name.endsWith(".json") ? [target] : [];
    }),
  );
  return nested.flat().sort();
}

/** Mulberry32 gives deterministic sampling on every supported OS/Node version. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

export function sampleCharacterFiles(
  files: string[],
  count?: number,
): string[] {
  if (count === undefined || count >= files.length) return [...files].sort();
  const shuffled = [...files].sort();
  const random = seededRandom(SAMPLE_SEED);
  for (let index = shuffled.length - 1; index > 0; index--) {
    const swap = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swap]] = [shuffled[swap], shuffled[index]];
  }
  return shuffled.slice(0, count).sort();
}

function profileSource(data: BehaviorChainFile): unknown {
  return {
    title: data.title,
    author: data.author,
    representative_name: data.representative_name,
    profile: data.profile,
    chapter_summaries: data.summary.map((chapter) => ({
      chapter_num: chapter.chapter_num,
      chapter_num_int: chapter.chapter_num_int,
      chapter_content: chapter.chapter_content,
    })),
  };
}

function profilePrompt(data: BehaviorChainFile): string {
  return `Convert the following BehaviorChain source material into this project's canonical character biography.

Use BOTH the structured profile and the complete chapter-by-chapter summaries. Preserve concrete facts needed to predict the character's behavior: stable traits demonstrated in action, values and beliefs, motivations and goals, commitments, capabilities and limitations, important relationships, formative events, recurring habits, emotional vulnerabilities, and how the character changes over the story.

Rules:
- The named representative character is the subject.
- Treat the source as canonical; do not add facts not supported by it.
- Resolve shallow profile labels into evidence-backed prose using the summaries.
- The description should be detailed enough to replace the original profile and history as the biography supplied to downstream calls.
- Do not discuss this conversion task, the dataset, answer choices, or benchmark questions.
- Return exactly one JSON object with no extra prose.

Source material:
${JSON.stringify(profileSource(data), null, 2)}

Return JSON only:
{
  "name": "the character's canonical name",
  "headline": "one concise identifying line",
  "description": "a detailed prose biography"
}`;
}

async function loadOrCreateProfile(
  relativePath: string,
  data: BehaviorChainFile,
  profileModel: string,
  requestPool: RequestPool,
): Promise<{ profile: ConvertedProfile; cacheHit: boolean }> {
  const sourceHash = hash(profileSource(data));
  const cacheFile = path.join(
    PROFILE_CACHE_DIR,
    `${safeStem(relativePath)}.json`,
  );
  const cachedRaw = await readJsonIfPresent(cacheFile);
  const cached = profileCacheSchema.safeParse(cachedRaw);
  if (
    cached.success &&
    cached.data.source_hash === sourceHash &&
    cached.data.model === profileModel
  ) {
    return { profile: cached.data.profile, cacheHit: true };
  }

  const profile = await generateWithRetry(requestPool, {
    schema: convertedProfileSchema,
    model: profileModel,
    system:
      "You create faithful, evidence-grounded character biographies from structured literary reference material.",
    prompt: profilePrompt(data),
  });
  await writeJsonAtomic(cacheFile, {
    version: PROFILE_PROMPT_VERSION,
    source_hash: sourceHash,
    model: profileModel,
    generated_at: new Date().toISOString(),
    profile,
  });
  return { profile, cacheHit: false };
}

function makeDescription(
  id: string,
  profile: ConvertedProfile,
  profileModel: string,
): Description {
  const generatedAt = new Date().toISOString();
  return {
    profile_id: id,
    name: profile.name,
    headline: profile.headline,
    description: profile.description,
    profile_generated_at: null,
    generated_at: generatedAt,
    model: profileModel,
  };
}

function makeScenario(
  id: string,
  profile: ConvertedProfile,
  example: BehaviorExample,
  situation: string,
): Scenario {
  const options = optionsSchema.parse(example.options_out_of_order);
  const generatedAt = new Date().toISOString();
  return {
    id,
    profile_id: id.split("__example_")[0],
    name: profile.name,
    headline: profile.headline,
    title: `BehaviorChain ${id}`,
    situation_type: "NORMAL",
    life_domain: null,
    situation,
    context: {
      relationship_profiles: "",
      tendencies: "",
      current_state: "",
      immediate_memories: "",
      reflective_memories: "",
      behaviorchain_options: JSON.stringify(options),
    },
    context_generated_at: generatedAt,
    description_generated_at: generatedAt,
    generated_at: generatedAt,
    model: "behaviorchain-source",
  };
}

/**
 * Removes an earlier node's now-stale question while retaining the narrative
 * that led up to it. The next dataset node begins with the gold behavior that
 * answered that question, so the growing prefix follows the authors' protocol
 * without feeding our own prediction back into later nodes.
 */
export function stripBehaviorQuestion(text: string): string {
  return text
    .replace(behaviorQuestionPattern(), " ")
    .trim()
    .replace(/,\s*$/, ".");
}

function behaviorQuestionPattern(): RegExp {
  return /\s*(?:(?:after this(?: or in response to this)?|in response to this),?\s*)?what behavior did [^?]+? take\?/gi;
}

/** Removes embedded stale questions but preserves the final, current one. */
export function keepOnlyCurrentBehaviorQuestion(text: string): string {
  const matches = [...text.matchAll(behaviorQuestionPattern())];
  if (matches.length <= 1) return text.trim();

  let result = "";
  let cursor = 0;
  for (const match of matches.slice(0, -1)) {
    const start = match.index;
    result += `${text.slice(cursor, start)} `;
    cursor = start + match[0].length;
  }
  return `${result}${text.slice(cursor)}`.trim();
}

/** Builds the gold, ordered chain prefix available when predicting one node. */
export function buildSequentialSituation(
  examples: BehaviorExample[],
  currentIndex: number,
): string {
  const currentRaw = examples[currentIndex]?.[CONTEXT_FIELD]?.trim();
  if (!currentRaw) {
    throw new Error(`Example ${currentIndex} has no ${CONTEXT_FIELD}.`);
  }
  const current = keepOnlyCurrentBehaviorQuestion(currentRaw);

  const history = examples
    .slice(1, currentIndex)
    .map((example) => example[CONTEXT_FIELD]?.trim())
    .filter((value): value is string => Boolean(value))
    .map(stripBehaviorQuestion);

  const historyBlock =
    history.length === 0
      ? "None — this is the first predicted node after the seed behavior."
      : history
          .map((entry, index) => `Earlier chain node ${index + 1}:\n${entry}`)
          .join("\n\n");

  return `PRIOR BEHAVIOR-CHAIN HISTORY
(These are earlier events in chronological order. They are not all happening now.)

${historyBlock}

CURRENT SITUATION AND QUESTION
(Predict only the behavior requested here.)

${current}`;
}

async function runFlow(
  relativePath: string,
  exampleIndex: number,
  flow: Flow,
  description: Description,
  scenario: Scenario,
  model: string,
  requestPool: RequestPool,
  onProgress: (event: ProgressEvent) => void,
): Promise<OptionKey> {
  const inputHash = hash({
    evaluation_version: EVALUATION_VERSION,
    relativePath,
    exampleIndex,
    flow: flow.key,
    model,
    description: description.description,
    situation: scenario.situation,
    options: scenario.context.behaviorchain_options,
    memories: { immediate: "", reflective: "" },
  });
  const cacheFile = path.join(
    EXECUTION_CACHE_DIR,
    safeStem(relativePath),
    `${exampleIndex}-${flow.key}.json`,
  );
  const cachedRaw = await readJsonIfPresent(cacheFile);
  const parsed = executionCacheSchema.safeParse(cachedRaw);
  let cache: ExecutionCache =
    parsed.success &&
    parsed.data.input_hash === inputHash &&
    parsed.data.flow === flow.key &&
    parsed.data.model === model
      ? parsed.data
      : {
          version: EVALUATION_VERSION,
          input_hash: inputHash,
          flow: flow.key,
          model,
          steps: {},
        };

  for (const step of flow.steps) {
    const existing = cache.steps[step.key];
    const complete =
      existing && step.fields.every((field) => field.key in existing.output);
    if (complete) {
      onProgress({ type: "progress", units: 1, cached: true });
      continue;
    }

    const prior = Object.fromEntries(
      Object.entries(cache.steps).map(([key, value]) => [key, value.output]),
    );
    const output = await generateWithRetry(requestPool, {
      schema: stepSchema(step),
      system: step.system,
      prompt: step.buildPrompt({ scenario, description, prior }),
      model,
    });
    cache = {
      ...cache,
      steps: {
        ...cache.steps,
        [step.key]: {
          output,
          generated_at: new Date().toISOString(),
          model,
        },
      },
    };
    await writeJsonAtomic(cacheFile, cache);
    onProgress({ type: "progress", units: 1, cached: false });
  }

  const decision = cache.steps[STEP_DECISION];
  if (!decision)
    throw new Error(`Flow ${flow.key} did not produce a decision.`);
  return choiceSchema.parse(decision.output).choice;
}

export function averageScore(correct: number[]): number {
  if (correct.length === 0) return 0;
  return correct.reduce((sum, value) => sum + value, 0) / correct.length;
}

/** Exact BehaviorChain normalized cumulative-score implementation. */
export function cumulativeScore(correct: number[]): number {
  if (correct.length === 0) return 0;
  let streak = 0;
  let cumulative = 0;
  for (const value of correct) {
    if (value === 1) {
      streak += 1;
      cumulative += streak;
    } else {
      streak = 0;
    }
  }
  return cumulative / ((correct.length * (correct.length + 1)) / 2);
}

/** Auxiliary longest-correct-run score emitted by the authors' released code. */
export function maxChainAccuracy(correct: number[]): number {
  if (correct.length === 0) return 0;
  let streak = 0;
  let longest = 0;
  for (const value of correct) {
    streak = value === 1 ? streak + 1 : 0;
    longest = Math.max(longest, streak);
  }
  return longest / correct.length;
}

type ExampleResult = {
  example_index: number;
  prediction: OptionKey;
  answer: OptionKey;
  correct: 0 | 1;
};

type CharacterResult = {
  file: string;
  title: string;
  author: string;
  character: string;
  profile_cache_hit: boolean | null;
  excluded_reason: string | null;
  skipped_examples: { example_index: number; reason: string }[];
  flows: Record<
    string,
    {
      examples: ExampleResult[];
      average_score: number;
      cumulative_score: number;
      max_chain_accuracy: number;
    }
  >;
};

function evaluableExamples(data: BehaviorChainFile): {
  valid: { example: BehaviorExample; index: number }[];
  skipped: { example_index: number; reason: string }[];
} {
  const valid: { example: BehaviorExample; index: number }[] = [];
  const skipped: { example_index: number; reason: string }[] = [];

  // examples[0] is the seed behavior. The paper evaluates successors only.
  data.examples.slice(1).forEach((example, offset) => {
    const index = offset + 1;
    const missing: string[] = [];
    if (!example[CONTEXT_FIELD]?.trim()) missing.push(CONTEXT_FIELD);
    if (!example.options_out_of_order) missing.push("options_out_of_order");
    if (!example.right_option_index) missing.push("right_option_index");
    if (missing.length > 0) {
      skipped.push({
        example_index: index,
        reason: `missing ${missing.join(", ")}`,
      });
    } else {
      valid.push({ example, index });
    }
  });
  return { valid, skipped };
}

async function evaluateCharacter(
  absolutePath: string,
  model: string,
  profileModel: string,
  requestPool: RequestPool,
  flowsToRun: Flow[],
  onProgress: (event: ProgressEvent) => void,
): Promise<CharacterResult> {
  const relativePath = path
    .relative(DATASET_DIR, absolutePath)
    .split(path.sep)
    .join("/");
  const data = behaviorChainFileSchema.parse(await readJson(absolutePath));
  const { valid, skipped } = evaluableExamples(data);
  if (valid.length === 0) {
    return {
      file: relativePath,
      title: data.title,
      author: data.author,
      character: data.representative_name,
      profile_cache_hit: null,
      excluded_reason: "no successor examples have a complete MCQ target",
      skipped_examples: skipped,
      flows: {},
    };
  }
  const sourceId = safeStem(relativePath);
  const { profile, cacheHit } = await loadOrCreateProfile(
    relativePath,
    data,
    profileModel,
    requestPool,
  );
  const description = makeDescription(sourceId, profile, profileModel);
  const flows: CharacterResult["flows"] = {};
  onProgress({ type: "progress", units: 1, cached: cacheHit });

  for (const flow of flowsToRun) {
    const results = await Promise.all(
      valid.map(async ({ example, index }): Promise<ExampleResult> => {
        const answer = optionKeySchema.parse(example.right_option_index);
        const scenario = makeScenario(
          `${sourceId}__example_${index}`,
          profile,
          example,
          buildSequentialSituation(data.examples, index),
        );
        const prediction = await runFlow(
          relativePath,
          index,
          flow,
          description,
          scenario,
          model,
          requestPool,
          onProgress,
        );
        const result: ExampleResult = {
          example_index: index,
          prediction,
          answer,
          correct: prediction === answer ? 1 : 0,
        };
        return result;
      }),
    );
    const correctness = results.map((result) => result.correct);
    flows[flow.key] = {
      examples: results,
      average_score: averageScore(correctness),
      cumulative_score: cumulativeScore(correctness),
      max_chain_accuracy: maxChainAccuracy(correctness),
    };
  }

  return {
    file: relativePath,
    title: data.title,
    author: data.author,
    character: profile.name,
    profile_cache_hit: cacheHit,
    excluded_reason: null,
    skipped_examples: skipped,
    flows,
  };
}

function parsePositiveOption(
  argv: string[],
  option: "--sample" | "--concurrency",
): number | undefined {
  const index = argv.indexOf(option);
  if (index === -1) return undefined;
  const raw = argv[index + 1];
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 1) {
    throw new Error(`${option} must be followed by a positive integer.`);
  }
  return value;
}

function parseFlowSet(argv: string[]): FlowSetKey {
  const option = "--flow-set";
  const index = argv.indexOf(option);
  if (index === -1) return "immediate-full";
  const value = argv[index + 1];
  if (!FLOW_SET_KEYS.includes(value as FlowSetKey)) {
    throw new Error(`${option} must be one of: ${FLOW_SET_KEYS.join(", ")}.`);
  }
  return value as FlowSetKey;
}

function macroAverage(values: number[]): number {
  return values.length === 0
    ? 0
    : values.reduce((sum, value) => sum + value, 0) / values.length;
}

async function main(): Promise<void> {
  loadEnvConfig(REPO_ROOT);
  const argv = process.argv.slice(2);
  const sample = parsePositiveOption(argv, "--sample");
  const flowSet = parseFlowSet(argv);
  const flowsToRun = flowsFor(flowSet);
  const configuredConcurrency = Number(process.env.BEHAVIORCHAIN_CONCURRENCY);
  const defaultConcurrency =
    Number.isInteger(configuredConcurrency) && configuredConcurrency >= 1
      ? configuredConcurrency
      : DEFAULT_REQUEST_CONCURRENCY;
  const concurrency =
    parsePositiveOption(argv, "--concurrency") ?? defaultConcurrency;
  const requestPool = new RequestPool(concurrency);
  const allFiles = await listJsonFiles(DATASET_DIR);
  const selected = sampleCharacterFiles(allFiles, sample);
  const model = configuredModel();
  const profileModel = process.env.BEHAVIORCHAIN_PROFILE_MODEL?.trim() || model;

  const workload = await Promise.all(
    selected.map(async (file) => {
      const data = behaviorChainFileSchema.parse(await readJson(file));
      return evaluableExamples(data).valid.length;
    }),
  );
  const stepsPerExample = flowsToRun.reduce(
    (total, flow) => total + flow.steps.length,
    0,
  );
  const evaluableCharacters = workload.filter((count) => count > 0).length;
  const totalUnits =
    evaluableCharacters +
    workload.reduce((total, count) => total + count * stepsPerExample, 0);
  emitEvent({
    type: "start",
    label:
      flowSet === "first-person"
        ? "First-person MCQ-conditioned"
        : flowSet === "first-person-head-only"
          ? "First-person head-only MCQ"
          : "Immediate + full flows",
    total_units: totalUnits,
    selected_characters: selected.length,
    total_characters: allFiles.length,
    sample_seed: SAMPLE_SEED,
    model,
    profile_model: profileModel,
    concurrency,
  });
  const onProgress = (event: ProgressEvent): void => emitEvent(event);

  const characters = await Promise.all(
    selected.map(async (file) => {
      return evaluateCharacter(
        file,
        model,
        profileModel,
        requestPool,
        flowsToRun,
        onProgress,
      );
    }),
  );

  const overall = Object.fromEntries(
    flowsToRun.map((flow) => {
      const scores = characters
        .map((character) => character.flows[flow.key])
        .filter((score) => score !== undefined);
      return [
        flow.key,
        {
          average_score: macroAverage(
            scores.map((score) => score.average_score),
          ),
          cumulative_score: macroAverage(
            scores.map((score) => score.cumulative_score),
          ),
          max_chain_accuracy: macroAverage(
            scores.map((score) => score.max_chain_accuracy),
          ),
        },
      ];
    }),
  );

  const report = {
    protocol: {
      sample_seed: SAMPLE_SEED,
      requested_sample: sample ?? null,
      selected_characters: selected.length,
      evaluated_characters: characters.filter(
        (character) => character.excluded_reason === null,
      ).length,
      total_characters: allFiles.length,
      context_field: CONTEXT_FIELD,
      sequential_context:
        "each node receives the ordered gold new_summary prefix from earlier nodes; prior questions are removed",
      multiple_choice_conditioning:
        flowSet === "first-person"
          ? "the a/b/c/d objective and candidates are supplied to every reasoning stage"
          : "the a/b/c/d candidates are supplied only to the replacement decision stage",
      seed_example_evaluated: false,
      memories: { immediate: "ablated", reflective: "ablated" },
      profile_source: "structured profile plus all chapter summaries",
      scoring:
        "exact option accuracy, BehaviorChain normalized cumulative score, and auxiliary maximum-chain accuracy; macro-averaged over characters",
      profile_prompt_version: PROFILE_PROMPT_VERSION,
      evaluation_version: EVALUATION_VERSION,
      flow_set: flowSet,
      concurrency: {
        maximum_requests: concurrency,
        peak_requests: requestPool.peak,
      },
      model,
      profile_model: profileModel,
    },
    generated_at: new Date().toISOString(),
    overall,
    characters,
  };
  const reportFile = path.join(
    REPORT_DIR,
    `${new Date().toISOString().replace(/[:.]/g, "-")}.json`,
  );
  await writeJsonAtomic(reportFile, report);

  emitEvent({
    type: "complete",
    overall,
    report: path.relative(REPO_ROOT, reportFile),
  });
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.stack : String(error));
    process.exitCode = 1;
  });
}
