import { z } from "zod";

export const DIGITAL_TWIN_DATASET_NAME = "LLM-Digital-Twin/Twin-2K-500";

export const digitalTwinProfileSummarySchema = z.object({
  id: z.string(),
  participant_id: z.number().int().positive(),
  source_file: z.string(),
  source_row: z.number().int().nonnegative(),
  persona_text_characters: z.number().int().nonnegative(),
  persona_json_characters: z.number().int().nonnegative(),
});

export const digitalTwinProfileSchema = digitalTwinProfileSummarySchema.extend({
  dataset: z.literal(DIGITAL_TWIN_DATASET_NAME),
  selection_id: z.string(),
  selection_seed: z.string(),
  selected_at: z.string(),
  wave1_3_persona_text: z.string().min(1),
  wave1_3_persona_json: z.string().min(1),
});

export const digitalTwinSelectionSchema = z.object({
  id: z.string(),
  dataset: z.literal(DIGITAL_TWIN_DATASET_NAME),
  seed: z.string(),
  selection_method: z.literal("seeded-random"),
  requested_count: z.number().int().positive(),
  selected_count: z.number().int().nonnegative(),
  total_available: z.number().int().positive(),
  created_at: z.string(),
  profiles: z.array(digitalTwinProfileSummarySchema),
});

export type DigitalTwinProfile = z.infer<typeof digitalTwinProfileSchema>;
export type DigitalTwinProfileSummary = z.infer<
  typeof digitalTwinProfileSummarySchema
>;
export type DigitalTwinSelection = z.infer<typeof digitalTwinSelectionSchema>;

