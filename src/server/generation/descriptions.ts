import "server-only";

import {
  descriptionContentSchema,
  type Description,
  type Stage1Config,
} from "@/lib/stage-1";
import type { Profile } from "@/lib/profile";
import { configuredModel, generateJson } from "@/server/llm/openrouter";
import type { RunContext } from "@/server/generation/runs";
import {
  MAX_CONCURRENT_REQUESTS,
  mapWithConcurrency,
} from "@/server/generation/runtime";
import {
  listDescriptions,
  readStage1Config,
  writeDescription,
} from "@/server/storage/descriptions";
import { listProfiles } from "@/server/storage/profiles";

/**
 * Stage 1 — the long description.
 *
 * Each Stage 0 profile is expanded into several hundred words of prose. The
 * output is one unstructured block, because every later stage's job is to
 * read a *description* rather than pre-structured fields.
 *
 * One profile per model call. Descriptions are long enough that batching them
 * would risk truncation and blur the people together.
 */

const SYSTEM_PROMPT = `You write character descriptions for a behavioral-prediction benchmark.

Expand the seed profile into a specific, believable portrait of the same person.

The description must establish:
- Personality through observable behavior, not trait labels or personality types.
- Core values, including tensions or contradictions between them.
- Cultural background and the culture of their current environment.
- Personal history, focusing on experiences that still affect how they think and behave.

Preserve all facts in the seed. Use concrete details rather than generic summaries. Do not predict behavior in hypothetical future situations.

Return only the requested JSON object.`;

function buildPrompt(profile: Profile, config: Stage1Config): string {
  return `Expand this seed into a character description of roughly ${config.target_word_count} words:

${JSON.stringify(
  {
    name: profile.name,
    description: profile.description,
    starting_attributes: profile.seed,
  },
  null,
  2,
)}

Return exactly:

{
  "description": "The full character description."
}`;
}

export type DescriptionResult =
  | { ok: true; profileId: string }
  | {
      ok: false;
      profileId: string;
      error: string;
      /**
       * Set when this item never really ran, or died on the aborted signal,
       * because the run was cancelled. Such items are the cancel rather than
       * findings — the run record already ignores them, and so must the summary.
       */
      aborted?: boolean;
    };

async function generateOne(
  profile: Profile,
  config: Stage1Config,
  model: string,
  run?: RunContext,
): Promise<DescriptionResult> {
  // A cancel can't stop the worker loop mid-flight, so it is checked here too —
  // otherwise every remaining profile still pays for a model call that only
  // fails once it reaches the aborted signal.
  if (run?.signal.aborted) {
    return {
      ok: false,
      profileId: profile.id,
      error: "Cancelled before this profile started.",
      aborted: true,
    };
  }

  try {
    const { description } = await generateJson({
      schema: descriptionContentSchema,
      system: SYSTEM_PROMPT,
      prompt: buildPrompt(profile, config),
      signal: run?.signal,
    });

    const record: Description = {
      profile_id: profile.id,
      name: profile.name,
      headline: profile.headline,
      description,
      profile_generated_at: profile.generated_at,
      generated_at: new Date().toISOString(),
      model,
    };

    await writeDescription(record);
    run?.itemDone();
    return { ok: true, profileId: profile.id };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    run?.itemFailed({ id: profile.id, error: message });
    return {
      ok: false,
      profileId: profile.id,
      error: message,
      aborted: run?.signal.aborted === true,
    };
  }
}

export type GenerateDescriptionsSummary = {
  model: string;
  profileCount: number;
  attempted: number;
  generated: number;
  failed: number;
  /** Profiles left alone because they already had a current description. */
  skipped: number;
  errors: { profileId: string; error: string }[];
};

/**
 * Fans out over EVERY Stage 0 profile — the pipeline is cumulative, so a run
 * covers the whole population, not a sample.
 *
 * `skipExisting` keeps a re-run cheap: only profiles without a description are
 * generated. With it off, every description is regenerated and overwritten.
 *
 * Failures are collected per profile rather than thrown, so one bad response
 * doesn't discard the descriptions that did generate.
 */
export async function generateDescriptions({
  skipExisting,
  run,
}: {
  skipExisting: boolean;
  run?: RunContext;
}): Promise<GenerateDescriptionsSummary> {
  const model = configuredModel();
  const config = await readStage1Config();
  const profiles = await listProfiles();

  // Keyed by id AND profile timestamp: a description whose profile has since
  // been regenerated describes someone else, so skip-existing must not treat it
  // as done. Ids are reused by a replacing Stage 0 run, which is exactly how a
  // stale description gets silently paired with a new person.
  const current = new Map(
    profiles.map((profile) => [profile.id, profile.generated_at]),
  );

  const fresh = new Set(
    skipExisting
      ? (await listDescriptions())
          .filter(
            (description) =>
              description.profile_generated_at !== null &&
              description.profile_generated_at ===
                current.get(description.profile_id),
          )
          .map((description) => description.profile_id)
      : [],
  );

  const targets = profiles.filter((profile) => !fresh.has(profile.id));
  run?.setTotal(targets.length);

  const results = await mapWithConcurrency(
    targets,
    MAX_CONCURRENT_REQUESTS,
    (profile) => generateOne(profile, config, model, run),
  );

  // Items abandoned to a cancel are neither generated nor failed — they never
  // got a verdict. Counting them as failures made every cancelled run report a
  // wall of failures that never happened.
  const generated = results.filter((result) => result.ok).length;
  const failures = results.filter(
    (result): result is Extract<DescriptionResult, { ok: false }> =>
      !result.ok && !result.aborted,
  );

  return {
    model,
    profileCount: profiles.length,
    attempted: generated + failures.length,
    generated,
    failed: failures.length,
    skipped: profiles.length - targets.length,
    errors: failures.map(({ profileId, error }) => ({ profileId, error })),
  };
}
