import { z } from "zod";

/**
 * Stage 2 — the episode: one situation a Stage 1 person is in, plus everything
 * that situation puts in play. Written in two model calls:
 *
 *   Call 1 writes the situation alone, from the Stage 1 description, steered
 *   toward one situation type and one life domain. Nothing else, so the
 *   situation is not shaped by the reactions to it.
 *
 *   Call 2 takes the person and that situation, and writes everything the
 *   situation puts in play — relationships, tendencies, current state,
 *   immediate and reflective memories. Split out because each of these is a
 *   consequence of the moment chosen: asking for them in the same breath as the
 *   situation lets the situation drift toward whatever is easy to react to.
 *
 * Together the two halves are the complete scenario ground truth Stage 3's flows
 * read. Both calls are driven by `data/stage-2-fields.json`.
 */

/** One prose block call 2 must write. */
export const stage2SectionSchema = z.object({
  key: z.string().min(1),
  label: z.string().min(1),
  guidance: z.string().min(1),
});

/** Call 1's single block. Labelled but unkeyed — there is only ever one. */
export const stage2SituationSchema = z.object({
  label: z.string().min(1),
  guidance: z.string().min(1),
});

export const stage2ConfigSchema = z.object({
  /**
   * Ceiling on items call 2 may list per context section. The prompt caps items
   * rather than words: an item is one short sentence, so counting them is the
   * limit that actually binds.
   */
  context_max_items_per_field: z.number().int().min(1).max(10),
  default_per_person: z.number().int().min(1),
  max_per_person: z.number().int().min(1),
  /** Call 1: what the situation itself must cover. */
  situation: stage2SituationSchema,
  /** Call 2: one block of extracted facts each, per configured subject. */
  context_sections: z.array(stage2SectionSchema).min(1),
});

export type Stage2Section = z.infer<typeof stage2SectionSchema>;
export type Stage2Situation = z.infer<typeof stage2SituationSchema>;
export type Stage2Config = z.infer<typeof stage2ConfigSchema>;

/**
 * Call 1 is steered toward one of three situation types, cycled at a fixed
 * 50/25/25 ratio (NORMAL / CULTURE_RELEVANT / TIME_SENSITIVE) across each
 * person's scenarios and across the population — see `SITUATION_TYPE_CYCLE` and
 * `scheduleAt` in `src/server/generation/scenarios.ts`.
 */
export const situationTypeSchema = z.enum([
  "NORMAL",
  "CULTURE_RELEVANT",
  "TIME_SENSITIVE",
]);

export type SituationType = z.infer<typeof situationTypeSchema>;

/**
 * The area of life call 1 centres the situation on. Steered independently of the
 * situation type, so the two vary across the population rather than moving in
 * lockstep — see `LIFE_DOMAIN_CYCLE` and `scheduleAt`.
 */
export const lifeDomainSchema = z.enum([
  "WORK",
  "FAMILY",
  "FRIENDSHIP",
  "ROMANTIC",
  "PERSONAL_ROUTINES",
  "LEISURE",
]);

export type LifeDomain = z.infer<typeof lifeDomainSchema>;

/** The persisted scenario: the situation, plus the context around it. */
export const scenarioSchema = z.object({
  id: z.string(),
  profile_id: z.string(),
  /** Copied from the description so lists render without reading Stage 1 too. */
  name: z.string(),
  headline: z.string(),
  /** Short handle for lists. */
  title: z.string(),
  /** The situation type this scenario was steered toward. */
  situation_type: situationTypeSchema,
  /**
   * The life domain this scenario was steered toward. Null on records written
   * before domains existed — treated as unknown rather than guessed at, the same
   * way a null `profile_generated_at` is in Stage 1.
   */
  life_domain: lifeDomainSchema.nullable().default(null),
  /** Call 1's output: the situation stated neutrally. */
  situation: z.string().min(1),
  /**
   * Call 2's output, keyed by the `context_sections` keys from
   * `data/stage-2-fields.json`. Empty only if call 2 failed after call 1 had
   * already written — see `context_generated_at`.
   */
  context: z.record(z.string(), z.string()),
  /**
   * When call 2 ran, or null if it never did. A scenario with a situation and
   * no context is half-generated rather than finished, and re-running fills it.
   */
  context_generated_at: z.string().nullable(),
  /** When the Stage 1 description this was built from was generated. */
  description_generated_at: z.string(),
  generated_at: z.string(),
  model: z.string(),
});

export type Scenario = z.infer<typeof scenarioSchema>;
