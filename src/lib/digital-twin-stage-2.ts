import { z } from "zod";

export const digitalTwinTargetQuestionSchema = z
  .object({
    QuestionID: z.string().min(1),
    QuestionText: z.string(),
    QuestionType: z.string().min(1),
    BlockName: z.string().min(1),
    csv_columns: z.array(z.string()),
  })
  .catchall(z.unknown());

export const digitalTwinEpisodeSchema = z.object({
  id: z.string(),
  profile_id: z.string(),
  participant_id: z.number().int().positive(),
  selection_id: z.string(),
  task_key: z.string(),
  task_label: z.string(),
  situation_type: z.literal("NORMAL"),
  situation: z.string().min(1),
  questions: z.array(digitalTwinTargetQuestionSchema).min(1),
  target_columns: z.array(z.string()),
  context: z.record(z.string(), z.string()),
  stage1_generated_at: z.string(),
  generated_at: z.string(),
  model: z.string(),
});

export type DigitalTwinTargetQuestion = z.infer<
  typeof digitalTwinTargetQuestionSchema
>;
export type DigitalTwinEpisode = z.infer<typeof digitalTwinEpisodeSchema>;
