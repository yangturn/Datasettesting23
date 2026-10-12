import "server-only";

import type { Description } from "@/lib/stage-1";
import type { Scenario } from "@/lib/stage-2";
import {
  SCORE_DIMENSIONS,
  SCORE_DIMENSION_SET,
  SCORE_SCALE_MAX,
} from "@/lib/stage-4";
import { FLOWS } from "@/server/flows";
import {
  flowAppliesTo,
  flowStepsFor,
  type Flow,
  type FlowStep,
} from "@/server/flows/types";
import { listDescriptions } from "@/server/storage/descriptions";
import { listAllEvaluations } from "@/server/storage/evaluations";
import { listAllExecutions } from "@/server/storage/executions";
import { listAllScenarios } from "@/server/storage/scenarios";

/**
 * The hand-off bundle: one row per episode with every flow's scores, plus
 * what a reader needs to judge the comparison — which model, how many
 * episodes per flow, what each flow spent in tokens, and the prompts of the
 * parts a control differs in.
 *
 * Episode-level rather than averaged, because paired intervals and
 * significance can only be computed from the pairs; a table of means cannot
 * be unpacked into them. Only evaluations on the current scale and dimension
 * set are exported, the same rule the scoreboard applies: a score from a
 * superseded judge is a different measurement wearing the same digit.
 */

/**
 * The names the paper uses, for the export's column headers and keys. The
 * internal flow keys name the code, not the method: a reader of the CSV wants
 * SECOND_THOUGHT, not `full_flow_first_person`. A flow without an entry is
 * exported under its key, upper-cased, so a new flow is never silently
 * dropped from the table.
 */
const PAPER_NAMES: Record<string, string> = {
  full_flow_first_person: "SECOND_THOUGHT",
  full_flow_v2: "SECOND_THOUGHT_3RD_PERSON",
  five_call_control: "FIVE_CALL_CONTROL",
  her_dual_layered_thinking: "HER",
  direct_zero_shot: "DIRECT_ZERO_SHOT",
  om_cot: "OM_COT",
};

export function paperName(flow: Flow): string {
  return PAPER_NAMES[flow.key] ?? flow.key.toUpperCase();
}

export type EpisodeRow = {
  profile_id: string;
  scenario_id: string;
  situation_type: string;
  decision_mode: string;
  /** Keyed by paper name; absent where the flow has no current score. */
  scores: Record<
    string,
    { overall: number; dimensions: Record<string, number> }
  >;
};

function placeholderInput(flow: Flow, upTo: FlowStep) {
  // Prior outputs are stood in for by the step and field they come from, so
  // the rendered template says where each block is read from.
  const prior: Record<string, Record<string, string>> = {};
  for (const step of flow.steps) {
    if (step === upTo) break;
    prior[step.key] = Object.fromEntries(
      step.fields.map((field) => [field.key, `{{${step.key}.${field.key}}}`]),
    );
  }
  const scenario: Scenario = {
    id: "{{scenario_id}}",
    profile_id: "{{profile_id}}",
    name: "{{name}}",
    headline: "",
    title: "",
    situation_type: "NORMAL",
    life_domain: null,
    situation: "{{objective_situation}}",
    context: {
      relationship_profiles: "{{relationship_profiles}}",
      tendencies: "{{tendencies}}",
      current_state: "{{current_state}}",
      immediate_memories: "{{immediate_memories}}",
      reflective_memories: "{{reflective_memories}}",
    },
    context_generated_at: null,
    description_generated_at: "",
    generated_at: "",
    model: "",
  };
  const description: Description = {
    profile_id: "{{profile_id}}",
    name: "{{name}}",
    headline: "",
    description: "{{character_biography}}",
    profile_generated_at: null,
    generated_at: "",
    model: "",
  };
  return { scenario, description, prior };
}

/** A flow's prompts, part by part, with the user template rendered on placeholders. */
export function flowPrompts(flow: Flow) {
  return flow.steps.map((step, index) => ({
    part: index + 1,
    key: step.key,
    label: step.label,
    fields: step.fields.map((field) => field.key),
    system: step.system,
    user_template: step.buildPrompt(placeholderInput(flow, step)),
  }));
}

export async function buildExport() {
  const [scenarios, descriptions, evaluations, executions] = await Promise.all([
    listAllScenarios(),
    listDescriptions(),
    listAllEvaluations(),
    listAllExecutions(),
  ]);

  const known = new Set(descriptions.map((d) => d.profile_id));
  const episodes = scenarios
    .filter((s) => s.context_generated_at !== null && known.has(s.profile_id))
    .sort(
      (a, b) =>
        a.profile_id.localeCompare(b.profile_id) || a.id.localeCompare(b.id),
    );

  const current = evaluations.filter(
    (e) =>
      e.score_scale === SCORE_SCALE_MAX &&
      e.dimension_set === SCORE_DIMENSION_SET,
  );
  const byCell = new Map(
    current.map((e) => [`${e.profile_id}/${e.scenario_id}/${e.flow_key}`, e]),
  );

  const rows: EpisodeRow[] = episodes.map((scenario) => {
    const scores: EpisodeRow["scores"] = {};
    let mode = "";
    for (const flow of FLOWS) {
      const evaluation = byCell.get(
        `${scenario.profile_id}/${scenario.id}/${flow.key}`,
      );
      if (!evaluation) continue;
      mode = evaluation.decision_mode;
      scores[paperName(flow)] = {
        overall: evaluation.overall_score,
        dimensions: Object.fromEntries(
          SCORE_DIMENSIONS.map((d) => [d.key, evaluation.scores[d.key] ?? NaN]),
        ),
      };
    }
    return {
      profile_id: scenario.profile_id,
      scenario_id: scenario.id,
      situation_type: scenario.situation_type,
      decision_mode: mode,
      scores,
    };
  });

  // Per flow: how many episodes it answered and was scored on, which models
  // produced them, and the tokens it spent where the provider reported them.
  const executionsByCell = new Map(
    executions.map((x) => [`${x.profile_id}/${x.scenario_id}/${x.flow_key}`, x]),
  );
  const flows = FLOWS.map((flow) => {
    const models = new Set<string>();
    let predicted = 0;
    let scored = 0;
    let stepsDone = 0;
    let stepsWithUsage = 0;
    let stepsCopied = 0;
    const tokens = { prompt: 0, completion: 0, reasoning: 0 };
    const byType: Record<string, number> = {};

    for (const scenario of episodes) {
      if (!flowAppliesTo(flow, scenario)) continue;
      const execution = executionsByCell.get(
        `${scenario.profile_id}/${scenario.id}/${flow.key}`,
      );
      if (!execution) continue;
      const steps = flowStepsFor(flow, scenario);
      const outcome = flow.outcome
        ? execution.steps[flow.outcome.stepKey]?.output[flow.outcome.fieldKey]
        : undefined;
      if (outcome) {
        predicted++;
        byType[scenario.situation_type] =
          (byType[scenario.situation_type] ?? 0) + 1;
      }
      if (byCell.has(`${scenario.profile_id}/${scenario.id}/${flow.key}`)) {
        scored++;
      }
      for (const step of steps) {
        const record = execution.steps[step.key];
        if (!record) continue;
        stepsDone++;
        models.add(record.model);
        if (record.copied_from) stepsCopied++;
        if (record.usage) {
          stepsWithUsage++;
          tokens.prompt += record.usage.prompt_tokens;
          tokens.completion += record.usage.completion_tokens;
          tokens.reasoning += record.usage.reasoning_tokens ?? 0;
        }
      }
    }

    return {
      name: paperName(flow),
      key: flow.key,
      label: flow.label,
      parts: flow.steps.map((s) => s.key),
      seed_from: flow.seedFrom ?? null,
      models: [...models],
      episodes_predicted: predicted,
      episodes_predicted_by_type: byType,
      episodes_scored: scored,
      steps_done: stepsDone,
      steps_copied_from_source: stepsCopied,
      steps_with_token_usage: stepsWithUsage,
      tokens,
    };
  });

  const judgeModels = [...new Set(current.map((e) => e.model))];

  return {
    exported_at: new Date().toISOString(),
    score_scale_max: SCORE_SCALE_MAX,
    dimension_set: SCORE_DIMENSION_SET,
    dimensions: SCORE_DIMENSIONS.map((d) => d.key),
    judge_models: judgeModels,
    episodes: rows.length,
    episodes_by_type: Object.fromEntries(
      ["NORMAL", "CULTURE_RELEVANT", "TIME_SENSITIVE"].map((t) => [
        t,
        rows.filter((r) => r.situation_type === t).length,
      ]),
    ),
    persons: new Set(rows.map((r) => r.profile_id)).size,
    flows,
    control_prompts: Object.fromEntries(
      FLOWS.filter((flow) => flow.seedFrom !== undefined).map((flow) => [
        paperName(flow),
        // Only the parts the control does not copy from its source: the ones
        // whose instructions differ, which is what a reader wants to inspect.
        flowPrompts(flow).filter((p) => p.part > 3),
      ]),
    ),
    rows,
  };
}

/** The rows as CSV: one line per episode, one column per flow × score. */
export function exportCsv(rows: EpisodeRow[]): string {
  const columns = ["profile_id", "scenario_id", "situation_type", "decision_mode"];
  for (const flow of FLOWS) {
    const name = paperName(flow);
    columns.push(`${name}_overall`);
    for (const d of SCORE_DIMENSIONS) columns.push(`${name}_${d.key}`);
  }
  const cell = (value: string | number | undefined) =>
    value === undefined || (typeof value === "number" && Number.isNaN(value))
      ? ""
      : String(value);
  const lines = [columns.join(",")];
  for (const row of rows) {
    const values: (string | number | undefined)[] = [
      row.profile_id,
      row.scenario_id,
      row.situation_type,
      row.decision_mode,
    ];
    for (const flow of FLOWS) {
      const score = row.scores[paperName(flow)];
      values.push(score?.overall);
      for (const d of SCORE_DIMENSIONS) values.push(score?.dimensions[d.key]);
    }
    lines.push(values.map(cell).join(","));
  }
  return lines.join("\n") + "\n";
}
