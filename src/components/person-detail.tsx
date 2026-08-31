import {
  PREFERENCE_LABELS,
  TENDENCY_LABELS,
  type Person,
} from "@/lib/person";
import { Field, Section, Tag } from "@/components/ui/section";

export function PersonDetail({ person }: { person: Person }) {
  const { background, behavioral_tendencies, preferences } = person;

  return (
    <div className="space-y-10">
      <Section title="Canonical description">
        <p className="text-sm leading-relaxed text-ink">
          {person.canonical_description}
        </p>
      </Section>

      <Section title="Background">
        <dl className="space-y-4">
          <Field label="Age">{background.age}</Field>
          <Field label="Occupation">{background.occupation}</Field>
          <Field label="Upbringing">{background.upbringing}</Field>
          <Field label="Current environment">
            {background.current_environment}
          </Field>
        </dl>
      </Section>

      <Section title="History" description="Important life events, by age.">
        <ol className="space-y-5">
          {background.important_life_events.map((life_event, index) => (
            <li
              key={`${life_event.age}-${index}`}
              className="grid gap-1 sm:grid-cols-[4rem_1fr] sm:gap-4"
            >
              <span className="text-sm font-medium text-ink-subtle tabular-nums">
                age {life_event.age}
              </span>
              <div className="space-y-1">
                <p className="text-sm leading-relaxed text-ink">
                  {life_event.event}
                </p>
                <p className="text-sm leading-relaxed text-ink-muted">
                  <span className="font-medium">Impact:</span>{" "}
                  {life_event.impact}
                </p>
              </div>
            </li>
          ))}
        </ol>
      </Section>

      <Section title="Behavioral tendencies">
        <dl className="space-y-4">
          {(
            Object.keys(TENDENCY_LABELS) as (keyof typeof TENDENCY_LABELS)[]
          ).map((key) => (
            <Field key={key} label={TENDENCY_LABELS[key]}>
              {behavioral_tendencies[key]}
            </Field>
          ))}
        </dl>
      </Section>

      <Section title="Values">
        <div className="flex flex-wrap gap-2">
          {person.values.map((value) => (
            <Tag key={value}>{value}</Tag>
          ))}
        </div>
      </Section>

      <Section title="Preferences">
        <dl className="space-y-4">
          {(
            Object.keys(PREFERENCE_LABELS) as (keyof typeof PREFERENCE_LABELS)[]
          ).map((key) => (
            <Field key={key} label={PREFERENCE_LABELS[key]}>
              {key === "leisure" ? (
                <div className="flex flex-wrap gap-2">
                  {preferences.leisure.map((item) => (
                    <Tag key={item}>{item}</Tag>
                  ))}
                </div>
              ) : (
                (preferences[key] as string)
              )}
            </Field>
          ))}
        </dl>
      </Section>

      <Section title="Habits">
        <ul className="space-y-2">
          {person.habits.map((habit) => (
            <li
              key={habit}
              className="text-sm leading-relaxed text-ink before:mr-2 before:text-ink-subtle before:content-['—']"
            >
              {habit}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Long-term goals">
        <ul className="space-y-2">
          {person.long_term_goals.map((goal) => (
            <li
              key={goal}
              className="text-sm leading-relaxed text-ink before:mr-2 before:text-ink-subtle before:content-['—']"
            >
              {goal}
            </li>
          ))}
        </ul>
      </Section>

      <Section title="Relationship style">
        <p className="text-sm leading-relaxed text-ink">
          {person.relationship_style}
        </p>
      </Section>
    </div>
  );
}
