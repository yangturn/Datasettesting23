import { z } from "zod";

export const evidenceConfidenceSchema = z.enum(["high", "medium", "low"]);

export const evidenceGroundedClaimSchema = z.object({
  claim: z.string().min(1),
  confidence: evidenceConfidenceSchema,
  source_question_ids: z.array(z.string().min(1)).min(1),
});

export const digitalTwinStage1ContentSchema = z.object({
  narrative: z.string().min(1),
  demographic_context: z.array(evidenceGroundedClaimSchema),
  values_and_beliefs: z.array(evidenceGroundedClaimSchema),
  personality_and_social_style: z.array(evidenceGroundedClaimSchema),
  decision_patterns: z.array(evidenceGroundedClaimSchema),
  risk_and_financial_preferences: z.array(evidenceGroundedClaimSchema),
  uncertainties_and_tensions: z.array(evidenceGroundedClaimSchema),
});

export const digitalTwinStage1RecordSchema =
  digitalTwinStage1ContentSchema.extend({
    profile_id: z.string(),
    participant_id: z.number().int().positive(),
    selection_id: z.string(),
    selection_seed: z.string(),
    generated_at: z.string(),
    model: z.string(),
    source_persona_text_characters: z.number().int().positive(),
    source_persona_json_characters: z.number().int().positive(),
  });

export type DigitalTwinStage1Content = z.infer<
  typeof digitalTwinStage1ContentSchema
>;
export type DigitalTwinStage1Record = z.infer<
  typeof digitalTwinStage1RecordSchema
>;

