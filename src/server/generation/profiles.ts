import "server-only";

import { z } from "zod";

import {
  DEFAULT_MAX_PROFILES_PER_RUN,
  profileContentSchema,
  type Profile,
  type ProfileSeed,
} from "@/lib/profile";
import { configuredModel, generateJson } from "@/server/llm/openrouter";
import { clearDescriptions } from "@/server/storage/descriptions";
import { clearEvaluationContexts } from "@/server/storage/evaluation-contexts";
import { clearEvaluations } from "@/server/storage/evaluations";
import { clearExecutions } from "@/server/storage/executions";
import { clearScenarios } from "@/server/storage/scenarios";
import type { RunContext } from "@/server/generation/runs";
import {
  MAX_CONCURRENT_REQUESTS,
  mapWithConcurrency,
  positiveIntEnv,
  type GenerationMode,
} from "@/server/generation/runtime";
import {
  clearProfiles,
  listProfiles,
  nextProfileNumber,
  profileId,
  writeProfile,
} from "@/server/storage/profiles";

/**
 * Stage 0 — diverse profile generation.
 *
 * Diversity is engineered, not hoped for. Asking one model call for N people
 * produces N variations on the same person, so instead every profile is
 * pre-assigned a distinct *slot*: a combination of demographic and
 * dispositional axes. The model's job is to invent a believable person who fits
 * the slot it was handed, and the spread comes from how the slots were drawn.
 *
 * Slots are then generated in parallel batches. Profiles inside a batch see
 * their siblings (so the model can pull them apart itself); profiles across
 * batches can't, which is exactly why the slots are made disjoint up front.
 *
 * A run either replaces the population (previous profiles deleted first, slots
 * restart at the top of every axis) or adds to it (slots continue the walk from
 * where the existing profiles left off, so new people don't retread old
 * combinations).
 */

/** Profiles per model call when `PROFILES_PER_REQUEST` is unset. */
const DEFAULT_PROFILES_PER_REQUEST = 10;

/** Existing profiles shown to an additive run as an avoid-list, newest first. */
const AVOID_LIST_LIMIT = 60;

export type { GenerationMode } from "@/server/generation/runtime";

/**
 * Ceiling on one run, from `MAX_PROFILES_PER_RUN` in the environment. Read at
 * call time — like the model config — so raising it doesn't need a code change.
 * A missing, non-numeric, or non-positive value falls back to the default.
 */
export function maxProfilesPerRun(): number {
  return positiveIntEnv(
    process.env.MAX_PROFILES_PER_RUN,
    DEFAULT_MAX_PROFILES_PER_RUN,
  );
}

/**
 * How many profiles share one model call, from `PROFILES_PER_REQUEST`.
 *
 * This is the diversity/robustness dial. Profiles in the same call see each
 * other, so a larger batch pulls them apart better and costs fewer requests —
 * but the response gets longer, and a failed call loses every profile in it.
 */
export function profilesPerRequest(): number {
  return positiveIntEnv(
    process.env.PROFILES_PER_REQUEST,
    DEFAULT_PROFILES_PER_REQUEST,
  );
}


/**
 * Diversity axes. `stride` is coprime with the number of values, so stepping
 * through profile indices walks every value on the axis before repeating — and
 * because the strides differ per axis, the *combinations* stay spread out
 * rather than repeating in lockstep.
 */
const AXES = {
  region: {
    stride: 1,
    values: [
      "West Africa",
      "the Nordic countries",
      "Southeast Asia",
      "the US Midwest",
      "Brazil",
      "South Asia",
      "the Middle East",
      "Eastern Europe",
      "East Asia",
      "the UK or Ireland",
      "Andean South America",
      "Australia or New Zealand",
      "the Caribbean",
      "Southern Europe",
      "Central Asia",
      "East Africa",
      "Mexico or Central America",
      "urban coastal North America",
    ],
  },
  gender: {
    stride: 2,
    values: [
      "a woman",
      "a man",
      "a woman",
      "a man",
      "a non-binary or self-described person",
    ],
  },
  age_band: {
    stride: 3,
    values: [
      "late teens",
      "early twenties",
      "late twenties",
      "thirties",
      "forties",
      "fifties",
      "sixties",
      "seventies or older",
    ],
  },
  socioeconomic: {
    stride: 5,
    values: [
      "poor, with unstable income",
      "working class",
      "lower middle class",
      "comfortably middle class",
      "affluent professional",
      "wealthy, with inherited money",
    ],
  },
  life_stage: {
    stride: 5,
    values: [
      "still studying or training",
      "starting out in work",
      "established mid-career",
      "changing direction entirely",
      "raising young children",
      "caring for an ageing parent",
      "recently divorced or separated",
      "recently bereaved",
      "newly retired",
      "long-term single and settled",
      "newly migrated to another country",
      "recovering from illness or injury",
    ],
  },
  domain: {
    stride: 5,
    values: [
      "manual trades or construction",
      "healthcare or caregiving",
      "teaching or academia",
      "software or engineering",
      "farming or fishing",
      "small business ownership",
      "the arts or performance",
      "law, finance, or administration",
      "military, policing, or emergency services",
      "religious or community work",
      "logistics, transport, or retail",
      "science or research",
      "unemployed or between jobs",
      "informal or gig work",
    ],
  },
  temperament: {
    stride: 4,
    values: [
      "cautious and methodical",
      "restless and impulsive",
      "warm and accommodating",
      "guarded and self-reliant",
      "ambitious and competitive",
      "sceptical and contrarian",
      "anxious and conscientious",
      "easy-going and improvisational",
      "stoic and duty-bound",
      "idealistic and principled",
      "pragmatic and transactional",
    ],
  },
} as const satisfies Record<string, { stride: number; values: readonly string[] }>;

/**
 * The coprime property above is load-bearing and easy to break by editing an
 * axis: adding one value can silently make a stride share a factor with the
 * length, and then the walk only ever reaches `length / gcd` of the values —
 * the rest never appear in any population. Checked at module load, because a
 * violation is a code bug, not a runtime condition.
 */
function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

for (const [name, axis] of Object.entries(AXES)) {
  if (gcd(axis.stride, axis.values.length) !== 1) {
    throw new Error(
      `Profile axis "${name}" has stride ${axis.stride} and ${axis.values.length} values, ` +
        `which share a factor — the walk would only reach ` +
        `${axis.values.length / gcd(axis.stride, axis.values.length)} of them. Pick a coprime stride.`,
    );
  }
}

function pick(axis: { stride: number; values: readonly string[] }, index: number) {
  return axis.values[(index * axis.stride) % axis.values.length];
}

/**
 * The slot for the nth profile of the whole population. Indexed by the
 * profile's sequence number, so a later run continues the walk across the axes
 * instead of restarting it and duplicating the first run's combinations.
 */
function seedFor(index: number): ProfileSeed {
  return {
    region: pick(AXES.region, index),
    gender: pick(AXES.gender, index),
    age_band: pick(AXES.age_band, index),
    socioeconomic: pick(AXES.socioeconomic, index),
    life_stage: pick(AXES.life_stage, index),
    domain: pick(AXES.domain, index),
    temperament: pick(AXES.temperament, index),
  };
}

const SYSTEM_PROMPT = `You create seed profiles for a behavioral-prediction benchmark.

Each profile is a SHORT sketch of one specific human being — who they are, not their whole life story. A later stage expands each sketch into a full canonical person, so your job is to stake out a distinct, believable individual, not to be exhaustive.

Rules:
- Write a real individual, not a demographic. Concrete details: an actual job, an actual place, an actual current circumstance.
- Fill the slot you are given. Every attribute of the slot must be recognisably true of the person you write.
- The slot is a starting point, not a stereotype. Do not write the most predictable person for those attributes — give them something specific that cuts against the obvious reading.
- The people in one request must be sharply different from each other: different names, places, occupations, textures of life. No two should read as the same person with details swapped.
- Names must fit the person's background and must not repeat within the request.
- Keep the description to 2-4 sentences. Concrete and plain. No lyricism, no summarising adjectives like "complex" or "multifaceted".
- Do not include personality-test results, scores, or trait labels. Describe the person.
- Return a single JSON object only. No prose, no code fences.`;

type Slot = { sequence: number; seed: ProfileSeed };

function describeSlot(slot: Slot, position: number): string {
  const { seed } = slot;
  return `${position}. ${seed.gender}, ${seed.age_band}, from or living in ${seed.region}; ${seed.socioeconomic}; ${seed.life_stage}; works in ${seed.domain}; broadly ${seed.temperament}.`;
}

function buildPrompt(slots: Slot[], avoid: string[]): string {
  const avoidBlock =
    avoid.length > 0
      ? `\n\nThese people are already in the population. Do not repeat them, their names, or their circumstances:\n${avoid
          .map((entry) => `- ${entry}`)
          .join("\n")}`
      : "";

  return `Write ${slots.length} profile${slots.length === 1 ? "" : "s"}, one for each slot below, in the same order.

Slots:
${slots.map((slot, index) => describeSlot(slot, index + 1)).join("\n")}${avoidBlock}

Return JSON with exactly this shape, with the "profiles" array in slot order and exactly ${slots.length} item${slots.length === 1 ? "" : "s"}:

{
  "profiles": [
    {
      "name": string,         // full name fitting their background
      "headline": string,     // one line: age, occupation, place
      "description": string   // 2-4 sentences on who they are
    }
  ]
}`;
}

export type ProfileBatchResult =
  | { ok: true; profiles: Profile[] }
  | { ok: false; slots: number[]; error: string };

async function generateBatch(
  slots: Slot[],
  avoid: string[],
  model: string,
  run?: RunContext,
): Promise<ProfileBatchResult> {
  try {
    // Pinning the array length makes a short or over-long batch a schema error,
    // which the client's corrective retry can fix, instead of silently
    // producing fewer profiles than the user asked for.
    const batchSchema = z.object({
      profiles: z.array(profileContentSchema).length(slots.length),
    });

    const { profiles: contents } = await generateJson({
      schema: batchSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(slots, avoid),
      signal: run?.signal,
    });

    const generatedAt = new Date().toISOString();

    const profiles = contents.map((content, index) => ({
      ...content,
      id: profileId(slots[index].sequence),
      seed: slots[index].seed,
      generated_at: generatedAt,
      model,
    }));

    // Written after the whole batch validates, so a failed batch leaves no
    // half-written slots on disk.
    await Promise.all(profiles.map((profile) => writeProfile(profile)));

    // Reported per profile, not per batch — one failed request costs the whole
    // batch, and the progress bar counts what was asked for.
    run?.itemDone(profiles.length);
    return { ok: true, profiles };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const sequences = slots.map((slot) => slot.sequence);
    run?.itemFailed(
      { id: `profiles ${sequences[0]}-${sequences[sequences.length - 1]}`, error: message },
      slots.length,
    );
    return { ok: false, slots: sequences, error: message };
  }
}

export type GenerateProfilesSummary = {
  model: string;
  mode: GenerationMode;
  requested: number;
  generated: number;
  failed: number;
  batches: number;
  /** Profiles from the previous run that a replacing run deleted. */
  removed: number;
  /** Downstream records a replacing run deleted along with them. */
  removedDescriptions: number;
  removedScenarios: number;
  removedExecutions: number;
  removedEvaluationContexts: number;
  removedEvaluations: number;
  errors: { slots: number[]; error: string }[];
};

/**
 * Generates `count` profiles, all batches in flight together — replacing the
 * population or adding to it, per `mode`.
 *
 * Failures are reported per batch rather than thrown, so one bad response
 * doesn't discard the profiles that did generate.
 */
export async function generateProfiles({
  count,
  mode,
  run,
}: {
  count: number;
  mode: GenerationMode;
  run?: RunContext;
}): Promise<GenerateProfilesSummary> {
  const model = configuredModel();
  run?.setTotal(count);

  let removed = 0;
  let removedDescriptions = 0;
  let removedScenarios = 0;
  let removedExecutions = 0;
  let removedEvaluationContexts = 0;
  let removedEvaluations = 0;
  let startSequence = 1;
  let avoid: string[] = [];

  if (mode === "replace") {
    // Wipe first, so no profile from a previous run survives alongside this
    // one's and slots restart at the top of every axis.
    removed = await clearProfiles();

    // Everything downstream goes with it. Ids are sequence numbers and this run
    // restarts the sequence, so a surviving description or scenario would be
    // silently re-paired with whichever new person lands on its old id — the
    // records would look present and correct while describing someone else.
    // Stage 3 executions and Stage 4 evaluation contexts go too: each is
    // about a scenario that is now gone.
    [
      removedDescriptions,
      removedScenarios,
      removedExecutions,
      removedEvaluationContexts,
      removedEvaluations,
    ] = await Promise.all([
      clearDescriptions(),
      clearScenarios(),
      clearExecutions(),
      clearEvaluationContexts(),
      clearEvaluations(),
    ]);
  } else {
    const existing = await listProfiles();
    startSequence = await nextProfileNumber();
    // The model can't see the existing population, so name it explicitly —
    // disjoint slots keep the *kinds* of people apart, this keeps the
    // individuals apart.
    avoid = existing
      .slice(-AVOID_LIST_LIMIT)
      .map((profile) => `${profile.name} — ${profile.headline}`);
  }

  const slots: Slot[] = Array.from({ length: count }, (_, offset) => {
    const sequence = startSequence + offset;
    // Seeded by sequence number, so an additive run continues the walk across
    // the axes instead of repeating the combinations already on disk.
    return { sequence, seed: seedFor(sequence - 1) };
  });

  const perRequest = profilesPerRequest();
  const batches: Slot[][] = [];
  for (let index = 0; index < slots.length; index += perRequest) {
    batches.push(slots.slice(index, index + perRequest));
  }

  const results = await mapWithConcurrency(
    batches,
    MAX_CONCURRENT_REQUESTS,
    (batch) => generateBatch(batch, avoid, model, run),
  );

  const generated = results.reduce(
    (sum, result) => sum + (result.ok ? result.profiles.length : 0),
    0,
  );

  return {
    model,
    mode,
    requested: count,
    generated,
    failed: count - generated,
    batches: batches.length,
    removed,
    removedDescriptions,
    removedScenarios,
    removedExecutions,
    removedEvaluationContexts,
    removedEvaluations,
    errors: results
      .filter((result): result is Extract<ProfileBatchResult, { ok: false }> => !result.ok)
      .map(({ slots: failedSlots, error }) => ({ slots: failedSlots, error })),
  };
}
