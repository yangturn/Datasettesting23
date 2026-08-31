import { z } from "zod";

/**
 * Canonical person — the Stage 1 ground-truth record.
 */

export const lifeEventSchema = z.object({
  age: z.number().int().nonnegative(),
  event: z.string(),
  impact: z.string(),
});

export const personBackgroundSchema = z.object({
  age: z.number().int().nonnegative(),
  occupation: z.string(),
  upbringing: z.string(),
  current_environment: z.string(),
  important_life_events: z.array(lifeEventSchema),
});

export const behavioralTendenciesSchema = z.object({
  social: z.string(),
  risk: z.string(),
  conflict: z.string(),
  planning: z.string(),
  impulsivity: z.string(),
  trust: z.string(),
  conformity: z.string(),
});

export const preferencesSchema = z.object({
  social_environment: z.string(),
  work_environment: z.string(),
  decision_style: z.string(),
  leisure: z.array(z.string()),
  communication: z.string(),
  money: z.string(),
  relationships: z.string(),
  recognition: z.string(),
});

export const personSchema = z.object({
  id: z.string(),
  background: personBackgroundSchema,
  behavioral_tendencies: behavioralTendenciesSchema,
  values: z.array(z.string()),
  preferences: preferencesSchema,
  habits: z.array(z.string()),
  long_term_goals: z.array(z.string()),
  relationship_style: z.string(),
  canonical_description: z.string(),
});

export type LifeEvent = z.infer<typeof lifeEventSchema>;
export type Person = z.infer<typeof personSchema>;

/** Compact shape for list views — avoids shipping every field to the client. */
export const personSummarySchema = z.object({
  id: z.string(),
  age: z.number(),
  occupation: z.string(),
  canonical_description: z.string(),
  values: z.array(z.string()),
});

export type PersonSummary = z.infer<typeof personSummarySchema>;

export function toPersonSummary(person: Person): PersonSummary {
  return {
    id: person.id,
    age: person.background.age,
    occupation: person.background.occupation,
    canonical_description: person.canonical_description,
    values: person.values,
  };
}

/** Human-readable labels for the behavioral tendency keys. */
export const TENDENCY_LABELS: Record<
  keyof z.infer<typeof behavioralTendenciesSchema>,
  string
> = {
  social: "Social",
  risk: "Risk",
  conflict: "Conflict",
  planning: "Planning",
  impulsivity: "Impulsivity",
  trust: "Trust",
  conformity: "Conformity",
};

/** Human-readable labels for the preference keys. */
export const PREFERENCE_LABELS: Record<
  keyof z.infer<typeof preferencesSchema>,
  string
> = {
  social_environment: "Social environment",
  work_environment: "Work environment",
  decision_style: "Decision style",
  leisure: "Leisure",
  communication: "Communication",
  money: "Money",
  relationships: "Relationships",
  recognition: "Recognition",
};
