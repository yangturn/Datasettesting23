import { z } from "zod";

/**
 * Stage 1 — the long description.
 *
 * One Stage 0 profile expanded into several hundred words of prose about who
 * this person is. The output is deliberately unstructured: it is a person
 * described, not a form filled in.
 *
 * The description is the stage's only output, and the canonical text every
 * later stage reads. Stage 2 builds scenarios from this prose directly.
 */

export const stage1ConfigSchema = z.object({
  /** Rough length target for the description prose. */
  target_word_count: z.number().int().min(100).max(5000),
});

export type Stage1Config = z.infer<typeof stage1ConfigSchema>;

/** The model-generated body of a description. */
export const descriptionContentSchema = z.object({
  /** Several hundred words of plain prose. Paragraphs separated by blank lines. */
  description: z.string().min(1),
});

/** The persisted record: prose plus provenance. */
export const descriptionSchema = descriptionContentSchema.extend({
  profile_id: z.string(),
  /** Copied from the profile so lists render without reading Stage 0 too. */
  name: z.string(),
  headline: z.string(),
  /**
   * When the Stage 0 profile this describes was generated.
   *
   * Profile ids are sequence numbers (`profile_001`), and a replacing Stage 0
   * run restarts that sequence — so an id alone cannot tell you whether a
   * description still belongs to the profile now sitting at that id. Comparing
   * timestamps can. Null on records written before this field existed, which are
   * treated as stale precisely because their provenance is unknown.
   */
  profile_generated_at: z.string().nullable().default(null),
  generated_at: z.string(),
  model: z.string(),
});

export type DescriptionContent = z.infer<typeof descriptionContentSchema>;
export type Description = z.infer<typeof descriptionSchema>;
