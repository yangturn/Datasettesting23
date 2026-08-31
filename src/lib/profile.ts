import { z } from "zod";

/**
 * A Stage 0 profile: a short sketch of who someone is. This is the seed the
 * pipeline starts from — Stage 1 elaborates each profile into a full canonical
 * person (background, history, tendencies, values, preferences, goals, habits).
 *
 * Profiles stay deliberately thin. Their only job is to stake out a distinct
 * person so the population is diverse before any depth is added.
 */

/**
 * The diversity slot a profile was generated to fill. Persisted with the
 * profile so coverage across the population is auditable rather than assumed —
 * if a run comes back homogeneous, these fields show where it collapsed.
 */
export const profileSeedSchema = z.object({
  region: z.string(),
  gender: z.string(),
  age_band: z.string(),
  socioeconomic: z.string(),
  life_stage: z.string(),
  domain: z.string(),
  temperament: z.string(),
});

/** The model-generated body of a profile. */
export const profileContentSchema = z.object({
  /** A plausible full name for the person. */
  name: z.string().min(1),
  /** One line: age, occupation, place — enough to tell profiles apart in a list. */
  headline: z.string().min(1),
  /** Two to four sentences on who this person is. Stage 1 expands this. */
  description: z.string().min(1),
});

/** The persisted record: generated content plus its slot and provenance. */
export const profileSchema = profileContentSchema.extend({
  id: z.string(),
  seed: profileSeedSchema,
  generated_at: z.string(),
  model: z.string(),
});

export type ProfileSeed = z.infer<typeof profileSeedSchema>;
export type ProfileContent = z.infer<typeof profileContentSchema>;
export type Profile = z.infer<typeof profileSchema>;

/**
 * Fallback ceiling on one generation run, used when `MAX_PROFILES_PER_RUN` is
 * absent from the environment. The effective limit is read server-side by
 * `maxProfilesPerRun()` and handed to the UI, so the two can't drift.
 */
export const DEFAULT_MAX_PROFILES_PER_RUN = 500;

/** Human-readable labels for the seed axes, for UI. */
export const SEED_LABELS: Record<keyof ProfileSeed, string> = {
  region: "Region",
  gender: "Gender",
  age_band: "Age",
  socioeconomic: "Socioeconomic",
  life_stage: "Life stage",
  domain: "Domain",
  temperament: "Temperament",
};
