import "server-only";

import { z } from "zod";

import type { Description } from "@/lib/stage-1";
import type {
  LifeDomain,
  Scenario,
  SituationType,
  Stage2Config,
  Stage2Section,
} from "@/lib/stage-2";
import { configuredModel, generateJson } from "@/server/llm/openrouter";
import type { RunContext } from "@/server/generation/runs";
import {
  MAX_CONCURRENT_REQUESTS,
  mapWithConcurrency,
  type GenerationMode,
} from "@/server/generation/runtime";
import { listDescriptions } from "@/server/storage/descriptions";
import { clearEvaluationContexts } from "@/server/storage/evaluation-contexts";
import { clearEvaluations } from "@/server/storage/evaluations";
import { clearExecutions } from "@/server/storage/executions";
import {
  clearScenarios,
  listScenariosForProfile,
  readStage2Config,
  writeScenario,
} from "@/server/storage/scenarios";

/**
 * Stage 2 — the scenario, in two calls.
 *
 * Call 1 (`SITUATION_SYSTEM_PROMPT`) sees the Stage 1 description and nothing
 * else: the situation must be a reading of the canonical text, not of the Stage 0
 * seed behind it. It writes the situation and nothing more, steered toward one of
 * three situation types (a fixed 50/25/25 ratio) and one of six life domains (an
 * even split) — see `scheduleAt` for how the two are walked together and
 * `personCycleOffset` for how the walk is spread across the population.
 *
 * Call 2 (`contextSystemPrompt`) sees the person and the situation together,
 * and generates decision-relevant context for each configured section —
 * relationships, tendencies, current state, immediate and reflective memories.
 * It may invent detail the description never stated, so
 * long as it fits the canonical person and situation; the point is context
 * specific enough for a later stage to reason from. Terse by design: one short
 * clause per line, nothing that restates the situation. These are all
 * consequences of the moment chosen, so they come after it exists rather than
 * alongside it — asked for in the same breath, they pull the situation toward
 * whatever is easiest to react to.
 *
 * The situation is persisted before call 2 runs. A failed second call therefore
 * leaves a scenario with `context_generated_at: null` rather than losing the
 * situation that was already paid for, and re-running fills it in.
 *
 * People run in parallel; a person's own scenarios still run in sequence, since
 * the schedule position each one takes is counted from how many that person
 * already has. The situations themselves are generated independently — nothing
 * is told about a person's earlier scenarios, so the type and domain rotation is
 * the only thing keeping them apart.
 */

/**
 * Four slots, indexed by `scheduleAt`. NORMAL takes two of them, which is what
 * makes the split an exact 50/25/25 over every four scenarios rather than the
 * even thirds a three-slot cycle would give.
 */
const SITUATION_TYPE_CYCLE: SituationType[] = [
  "NORMAL",
  "CULTURE_RELEVANT",
  "NORMAL",
  "TIME_SENSITIVE",
];

/** The six life domains, one slot each — an even split, unlike the types. */
const LIFE_DOMAIN_CYCLE: LifeDomain[] = [
  "WORK",
  "FAMILY",
  "FRIENDSHIP",
  "ROMANTIC",
  "PERSONAL_ROUTINES",
  "LEISURE",
];

/**
 * The type and domain for position `n` in the schedule.
 *
 * Both are read off `n`, but not with the same index: 4 types and 6 domains
 * share a factor of 2, so `n % 4` against `n % 6` would repeat after 12 steps
 * and only ever reach half the pairs — CULTURE_RELEVANT and TIME_SENSITIVE would
 * never land on WORK, FRIENDSHIP, or PERSONAL_ROUTINES in any population. The
 * type index therefore advances one extra step per lap of the domain cycle,
 * which stretches the period to 24 and reaches every pair.
 *
 * The domain keeps the plain `n % 6` because that is the index whose window
 * matters most: it makes any six consecutive positions six distinct domains,
 * while the types still come out to an exact 50/25/25 over any aligned four.
 */
function scheduleAt(n: number): {
  situationType: SituationType;
  lifeDomain: LifeDomain;
} {
  const lap = Math.floor(n / LIFE_DOMAIN_CYCLE.length);
  return {
    situationType:
      SITUATION_TYPE_CYCLE[(n + lap) % SITUATION_TYPE_CYCLE.length],
    lifeDomain: LIFE_DOMAIN_CYCLE[n % LIFE_DOMAIN_CYCLE.length],
  };
}

/**
 * The pair coverage above is load-bearing and easy to break by editing either
 * cycle — a sixth type or a seventh domain silently changes which combinations
 * are reachable, and a whole cell of the grid can vanish without any test
 * failing. Checked at module load, in the spirit of the axis-stride check in
 * `profiles.ts`, because a violation is a code bug rather than a runtime one.
 */
const SCHEDULE_PERIOD =
  (SITUATION_TYPE_CYCLE.length * LIFE_DOMAIN_CYCLE.length) /
  ((): number => {
    const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
    return gcd(SITUATION_TYPE_CYCLE.length, LIFE_DOMAIN_CYCLE.length);
  })();

{
  const seen = new Set<string>();
  // One full period plus a lap, so a schedule that fails to close on itself
  // shows up as a short pair count rather than passing by luck.
  for (let n = 0; n < SCHEDULE_PERIOD * 2; n++) {
    const { situationType, lifeDomain } = scheduleAt(n);
    seen.add(`${situationType} ${lifeDomain}`);
  }

  const distinctTypes = new Set(SITUATION_TYPE_CYCLE).size;
  const expected = distinctTypes * LIFE_DOMAIN_CYCLE.length;
  if (seen.size !== expected) {
    throw new Error(
      `Stage 2 schedule reaches ${seen.size} of ${expected} situation-type/life-domain pairs — ` +
        `some combination can never be generated. Adjust the cycles or how ` +
        `scheduleAt indexes them.`,
    );
  }
}

/**
 * Where in the schedule a person's scenarios start, from their profile's
 * sequence number (`profile_007` → 7).
 *
 * The position also advances with each scenario a person has, but that alone
 * only spreads the schedule *within* one person: every person would start at
 * position 0, so a population generated one scenario each would be entirely
 * NORMAL/WORK. Offsetting by the person spreads both cycles across the
 * population too.
 *
 * Ids are sequence numbers, so this is stable across runs and independent of the
 * order descriptions happen to be listed in. An id that does not parse falls
 * back to 0 — no worse than not offsetting at all.
 */
function personCycleOffset(profileId: string): number {
  const match = /^profile_(\d+)$/.exec(profileId);
  return match ? Number(match[1]) : 0;
}

const SITUATION_SYSTEM_PROMPT = `You generate objective everyday situations for a behavioral-prediction benchmark.

Given a description of one person, a situation type, and a life domain, create one concrete situation they could plausibly encounter.

The purpose is to reveal ordinary behavioral differences. Situations may be casual and low-stakes, such as receiving an invitation, choosing how to spend an evening, responding to a small request, joining an activity, changing a routine, or deciding whether to continue a conversation. Do not force every situation into a moral dilemma, conflict, or major life decision.

General rules:
- Center the situation on the requested life domain.
- Describe only observable facts: where and when it happens, who is present, what happened or was said, and any relevant practical constraint.
- Introduce one specific event that gives the character a clear opportunity to respond.
- Create exactly one choice with at least two natural, plausible responses.
- The choice may be low-stakes. It only needs to reveal something about the character's preferences, habits, relationships, values, or way of responding.
- Prefer familiar situations from everyday life over dramatic, unusual, bureaucratic, or highly consequential events.
- Include only facts needed to understand the immediate choice.
- Do not explain what the situation reveals about the character.
- Write plain prose and stop after presenting the situation.

Follow the requested situation type:

NORMAL:
Create an ordinary, low- or moderate-stakes choice. Give the character enough time that urgency does not influence the response. Do not introduce culturally specific expectations as a central consideration.

CULTURE_RELEVANT:
Create an ordinary choice involving a cultural practice, expectation, etiquette, identity, or difference between the character's background and current environment. The cultural element must directly concern the activity or interaction. Do not add time pressure.

TIME_SENSITIVE:
Create an ordinary choice that must be made now because a conversation, invitation, activity, or small opportunity is currently happening. Do not use emergencies, compliance deadlines, administrative failures, financial losses, safety risks, or major workplace consequences.

Follow the requested life domain:

WORK:
Use ordinary interactions with colleagues, supervisors, responsibilities, meetings, breaks, workplace socializing, or small professional choices. Do not default to major career decisions, money, misconduct, or crises.

FAMILY:
Use ordinary interactions with parents, children, siblings, or extended family, including visits, meals, calls, traditions, favors, plans, and minor disagreements. Do not default to family emergencies or major obligations.

FRIENDSHIP:
Use invitations, conversations, group activities, favors, shared plans, teasing, minor tension, support, or changing social dynamics between friends. Casual situations are encouraged.

ROMANTIC:
Use dating, affection, communication, shared plans, intimacy, social presentation, or small disagreements involving a partner, date, former partner, or romantic interest. Do not default to betrayal, marriage, or breakups.

PERSONAL_ROUTINES:
Use sleep, food, exercise, errands, self-care, habits, household tasks, personal projects, or changes to the character's normal day. The situation may involve another person but should center on how the character manages everyday life.

LEISURE:
Use drinking, dining, sports, games, travel, hobbies, entertainment, clubs, parties, creative activities, or unstructured free time. Preferences and spontaneous invitations are valid sources of choice.

Return exactly one JSON object:

{
  "title": string,
  "situation": string
}`;

/**
 * Call 2's system prompt. The per-field item ceiling comes from the config
 * rather than the text, so the one number worth tuning stays editable alongside
 * the sections it governs.
 */
export function contextSystemPrompt(config: Stage2Config): string {
  return `You generate compact, decision-relevant character context for a behavioral-prediction benchmark.

You are given a character description and a situation. Expand them with plausible information about the character that could matter to their response in this specific situation.

The character description and situation are canonical. You may generate previously unstated relationships, goals, behavioral history, current states, and memories, but they must fit the established character and circumstances.

Rules:
- Generate only information that could plausibly influence the decision in this situation.
- Preserve and build on all established facts; never contradict either input.
- You may add plausible details not stated in the character description.
- Make generated details specific enough to support later reasoning.
- Keep generated context ordinary and proportionate to the situation. A casual choice should receive casual context.
- Do not introduce procedural complexity, specialized jargon, major consequences, trauma, debt, or dramatic history unless clearly supported by the character description.
- Do not repeat facts already stated in the situation.
- Use one short sentence or clause per item.
- Use at most ${config.context_max_items_per_field} items per field; fewer is better.
- Do not predict, recommend, or imply the eventual action.
- Do not make every field favor the same response. Where plausible, generate considerations pointing in different directions.
- Do not add a fact that makes one response clearly correct or overwhelmingly likely.
- For tendencies, describe repeated past behavior rather than traits or future behavior.
- Current state must exist before the situation's forcing event. Do not describe attention, emotion, or reasoning caused by the decision itself.
- Immediate memories should arise from a clear present cue, but they need not contain a lesson or favor an action.
- Reflective memories should add relevant personal history without resolving the decision.
- Return an empty string only when no useful information can be plausibly generated for a field.
- Return one JSON object only, with no additional prose.`;
}

/**
 * The context fields as call 2 is asked for them: the JSON key, then its
 * instructions. Labels are for the UI only — the model never sees them.
 */
function describeSections(sections: Stage2Section[]): string {
  return sections
    .map((section) => `"${section.key}"\n${section.guidance}`)
    .join("\n\n");
}

/** Call 1: the situation alone, from the description. */
function buildSituationPrompt({
  description,
  situationType,
  lifeDomain,
}: {
  description: Description;
  situationType: SituationType;
  lifeDomain: LifeDomain;
}): string {
  return `Description of ${description.name}:

"""
${description.description}
"""

Situation type: ${situationType}
Life domain: ${lifeDomain}

Create ONE everyday situation using the specified type and domain.

The situation may be casual and low-stakes. Do not manufacture conflict or serious consequences merely to make the choice seem important.

Write approximately 60-120 words.

Return JSON only:

{
  "title": "...",
  "situation": "..."
}`;
}

/** Call 2: the decision-relevant context around a situation that now exists. */
export function buildContextPrompt({
  description,
  config,
  title,
  situation,
  situationType,
}: {
  description: Description;
  config: Stage2Config;
  title: string;
  situation: string;
  situationType: SituationType;
}): string {
  return `Description of ${description.name}:

"""
${description.description}
"""

Current situation — "${title}":

"""
${situation}
"""

Situation type: ${situationType}

Generate the missing character context surrounding this situation. Treat the supplied description and situation as fixed, but plausibly expand the character's relationships, history, goals, behavioral patterns, current state, cultural context, and memories where needed.

Do not describe the eventual action or explain how the generated information should affect it.

${describeSections(config.context_sections)}

Keep the full output compact, roughly 120-180 words.

Return JSON with exactly these keys, each containing one item per line:

{
${config.context_sections
  .map((section) => `  "${section.key}": ""`)
  .join(",\n")}
}`;
}

/**
 * Call 1's output schema. `title` is pinned alongside the situation so a
 * scenario always has the short handle the avoid-list and listings need.
 */
const situationContentSchema = z.object({
  title: z.string().min(1),
  situation: z.string().min(1),
});

/**
 * Call 2's output schema, built from the config: every configured section key
 * must be present, so a dropped field is a schema error the client's corrective
 * retry can fix rather than a scenario silently missing its memories. The value
 * may be empty, though — the prompt allows an empty string for a field nothing
 * plausible can be generated for, and rejecting that would turn an honest blank
 * into a retry loop.
 */
export function buildContextSchema(config: Stage2Config) {
  return z.object(
    Object.fromEntries(
      config.context_sections.map((section) => [section.key, z.string()]),
    ),
  );
}

/** Shared by Generator and benchmark adapters so context generation stays identical. */
export async function generateScenarioContext({
  description,
  config,
  title,
  situation,
  situationType,
  signal,
}: {
  description: Description;
  config: Stage2Config;
  title: string;
  situation: string;
  situationType: SituationType;
  signal?: AbortSignal;
}) {
  return generateJson({
    schema: buildContextSchema(config),
    system: contextSystemPrompt(config),
    prompt: buildContextPrompt({
      description,
      config,
      title,
      situation,
      situationType,
    }),
    signal,
  });
}

export type ScenarioResult =
  | { ok: true; profileId: string; title: string }
  | {
      ok: false;
      profileId: string;
      error: string;
      /**
       * Set when this scenario died on the aborted signal because the run was
       * cancelled. Such items are the cancel rather than findings — the run
       * record already ignores them, and so must the summary.
       */
      aborted?: boolean;
    };

async function generateOne({
  description,
  config,
  situationType,
  lifeDomain,
  index,
  model,
  run,
}: {
  description: Description;
  config: Stage2Config;
  situationType: SituationType;
  lifeDomain: LifeDomain;
  index: number;
  model: string;
  run?: RunContext;
}): Promise<ScenarioResult> {
  let situationTitle: string | null = null;

  try {
    // ---- Call 1: the situation, from the description alone.
    const { title, situation } = await generateJson({
      schema: situationContentSchema,
      system: SITUATION_SYSTEM_PROMPT,
      prompt: buildSituationPrompt({ description, situationType, lifeDomain }),
      signal: run?.signal,
    });
    situationTitle = title;

    const scenario: Scenario = {
      // Timestamp-based so ids sort chronologically and a re-run never
      // overwrites an earlier scenario for the same person.
      id: `scenario_${Date.now().toString(36)}_${index}`,
      profile_id: description.profile_id,
      name: description.name,
      headline: description.headline,
      title,
      situation_type: situationType,
      life_domain: lifeDomain,
      situation,
      context: {},
      context_generated_at: null,
      description_generated_at: description.generated_at,
      generated_at: new Date().toISOString(),
      model,
    };

    // Written before call 2 so a failure there costs the context, not the
    // situation — which is already paid for and still worth keeping.
    await writeScenario(scenario);

    // ---- Call 2: what that situation puts in play, given the person and it.
    const context = await generateScenarioContext({
      description,
      config,
      title,
      situation,
      situationType,
      signal: run?.signal,
    });

    await writeScenario({
      ...scenario,
      context,
      context_generated_at: new Date().toISOString(),
    });

    run?.itemDone();
    return { ok: true, profileId: description.profile_id, title };
  } catch (error) {
    const raw = error instanceof Error ? error.message : String(error);
    // Which call failed is the first thing you want to know: a call-2 failure
    // left a usable situation behind, a call-1 failure left nothing.
    const message =
      situationTitle === null
        ? `situation: ${raw}`
        : `context for "${situationTitle}": ${raw}`;
    run?.itemFailed({ id: description.profile_id, error: message });
    return {
      ok: false,
      profileId: description.profile_id,
      error: message,
      aborted: run?.signal.aborted === true,
    };
  }
}

export type GenerateScenariosSummary = {
  model: string;
  mode: GenerationMode;
  personCount: number;
  perPerson: number;
  generated: number;
  failed: number;
  /** Scenarios from previous runs that a replacing run deleted. */
  removed: number;
  /** Stage 3 flow executions deleted along with them. */
  removedExecutions: number;
  /** Stage 4 evaluation contexts deleted along with them. */
  removedEvaluationContexts: number;
  /** Stage 4 evaluations deleted along with them. */
  removedEvaluations: number;
  errors: { profileId: string; error: string }[];
};

/**
 * Fans out over EVERY Stage 1 description — cumulative, like every other stage.
 *
 * `add` gives each person `perPerson` more scenarios, since more scenarios per
 * person is more of the grid rather than a redo. `replace` deletes every existing
 * scenario first, for when the prompts or the schedule have changed and the old
 * situations are no longer comparable to the new ones.
 *
 * A replacing run cascades into Stage 3, for a different reason than a replacing
 * Stage 0 run does. Scenario ids are timestamped and never reissued, so nothing
 * here can be silently re-paired the way a reused profile id can be — but every
 * flow execution is about one specific scenario, and a replacing run leaves that
 * scenario gone. An `add` run cascades into nothing: it only ever appends.
 */
export async function generateScenarios({
  perPerson,
  mode,
  run,
}: {
  perPerson: number;
  mode: GenerationMode;
  run?: RunContext;
}): Promise<GenerateScenariosSummary> {
  const model = configuredModel();
  const config = await readStage2Config();
  const descriptions = await listDescriptions();
  run?.setTotal(descriptions.length * perPerson);

  // Wiped before anything is listed, so `existingCount` below sees the empty
  // directory and every person restarts their schedule from their own offset
  // rather than continuing past scenarios that no longer exist.
  const [
    removed,
    removedExecutions,
    removedEvaluationContexts,
    removedEvaluations,
  ] =
    mode === "replace"
      ? await Promise.all([
          clearScenarios(),
          clearExecutions(),
          clearEvaluationContexts(),
          clearEvaluations(),
        ])
      : [0, 0, 0, 0];

  const perPersonResults = await mapWithConcurrency(
    descriptions,
    MAX_CONCURRENT_REQUESTS,
    async (description) => {
      // Only the count is needed now — it sets where the situation-type cycle
      // resumes. Prior situations are not shown to the model, so a person's
      // scenarios are kept apart by situation type alone.
      const existingCount = (
        await listScenariosForProfile(description.profile_id)
      ).length;
      // Starting point in the cycle for this person, so the split spreads across
      // the population and not only across one person's own scenarios.
      const cycleOffset = personCycleOffset(description.profile_id);
      const results: ScenarioResult[] = [];

      for (let index = 0; index < perPerson; index++) {
        // A person's scenarios run in sequence, so a cancel has to be checked
        // between them — otherwise the loop keeps queueing calls that only
        // fail once they reach the aborted signal.
        if (run?.signal.aborted) break;

        // Resume the schedule from where this person's existing scenarios left
        // off, so added scenarios keep walking type and domain instead of
        // repeating the first run's combinations.
        const { situationType, lifeDomain } = scheduleAt(
          cycleOffset + existingCount + index,
        );

        results.push(
          await generateOne({
            description,
            config,
            situationType,
            lifeDomain,
            index,
            model,
            run,
          }),
        );
      }

      return results;
    },
  );

  const results = perPersonResults.flat();
  // Scenarios abandoned to a cancel are neither generated nor failed — they
  // never got a verdict. Counting them as failures made every cancelled run
  // report a wall of failures that never happened.
  const generated = results.filter((result) => result.ok).length;
  const failures = results.filter(
    (result): result is Extract<ScenarioResult, { ok: false }> =>
      !result.ok && !result.aborted,
  );

  return {
    model,
    mode,
    personCount: descriptions.length,
    perPerson,
    generated,
    failed: failures.length,
    removed,
    removedExecutions,
    removedEvaluationContexts,
    removedEvaluations,
    errors: failures.map(({ profileId, error }) => ({ profileId, error })),
  };
}
