import { z } from "zod";

import { executionStepSchema } from "@/lib/stage-3";

export const digitalTwinAnswerSchema = z.union([z.number().finite(), z.string()]);

export const digitalTwinExecutionSchema = z.object({
  selection_id: z.string(),
  profile_id: z.string(),
  participant_id: z.number().int().positive(),
  episode_id: z.string(),
  task_key: z.string(),
  task_label: z.string(),
  flow_key: z.string(),
  steps: z.record(z.string(), executionStepSchema),
  answers: z.record(z.string(), digitalTwinAnswerSchema).nullable(),
  answers_generated_at: z.string().nullable(),
  stage1_generated_at: z.string(),
  episode_generated_at: z.string(),
  started_at: z.string(),
  updated_at: z.string(),
});

export type DigitalTwinAnswer = z.infer<typeof digitalTwinAnswerSchema>;
export type DigitalTwinExecution = z.infer<typeof digitalTwinExecutionSchema>;
