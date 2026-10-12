# Second Thought: Reflective Reappraisal for Persona Behavior Prediction

Code for the paper. A pipeline for comparing *flows* — candidate ways of prompting a language model to predict what a specific person does in a specific situation. It generates a synthetic population, puts each person in situations, runs every flow over every situation, and scores each flow's predicted action with a reference-free judge.

Everything runs through a local web app. All records are plain JSON files under `data/`; there is no database.

## Pipeline

| Stage | What it produces | Model calls |
| --- | --- | --- |
| 0 · Profiles | A short seed profile per person. Diversity is assigned up front: each profile is given a distinct slot across seven axes (region, gender, age band, socioeconomic position, life stage, domain, temperament) and the model writes a person who fits it. | One per batch of profiles |
| 1 · Descriptions | A prose character description of each person (target length in `data/stage-1-config.json`). This is the canonical text every later stage reads. | One per person |
| 2 · Scenarios | One or more episodes per person. Call 1 writes the objective situation from the description alone. Call 2 writes the episode context: relationship profiles, tendencies, current state, immediate memories and reflective memories. | Two per scenario |
| 3 · Flow execution | Every flow run over every scenario. A flow is an ordered pipeline of calls; each step sees the outputs of the steps before it and ends in one predicted action plus an explanation. | One per flow step |
| 4 · Evaluation | Part 1 consolidates the Stage 1 and Stage 2 material into an evaluation context, once per scenario and without seeing any flow's output. Part 2 scores each flow's action and explanation against it. | One per scenario, plus one per scenario × flow |

Situations are steered toward one of three types at a fixed 50/25/25 split — `NORMAL`, `CULTURE_RELEVANT`, `TIME_SENSITIVE` — and rotated evenly across six life domains. A `TIME_SENSITIVE` situation forces an immediate response, so reflective memories are withheld from every flow and from the judge on those scenarios.

## Flows

Flows are defined in code under `src/server/flows/` and registered in `src/server/flows/index.ts`.

| Key | Label | Steps |
| --- | --- | --- |
| `full_flow_v2` | Second Thought, 3rd person | Attribute extraction → consolidation → initial appraisal → reflective reappraisal → final decision |
| `full_flow_first_person` | Second Thought, 1st person (primary) | The same five steps, with the appraisal and reappraisal written in the character's first-person voice |
| `five_call_control` | Five-call control | The primary arm's first three steps, copied from its execution rather than re-run → memory recollection (the same reflective memories, restated factually, no reconsideration) → final decision from the initial tendency |
| `her_dual_layered_thinking` | Her Dual Layered Thinking | System thinking → role thinking and response → response conversion |
| `direct_zero_shot` | Direct Zero Shot | One call, with staged reasoning forbidden |
| `om_cot` | OM-COT | One call, with observation-then-memory reasoning prescribed inside it |

On a `TIME_SENSITIVE` scenario the two Second Thought flows skip the reappraisal and run four steps: extraction, consolidation, initial appraisal, immediate decision. The two arms differ only in the voice of the appraisal and reappraisal; extraction, consolidation and the decision prompts are shared.

`full-flow.ts` and `immediate-flow.ts` are not registered as flows of their own. They hold the reflective and immediate pipelines the two Second Thought flows are built from.

### Five-call control

A matched control for the reappraisal: five calls, the same memory-access timing and the same output requirements as the primary arm, but call 4 only restates the factual content of the reflective memories and call 5 decides from the initial tendency. If the primary arm still scores higher, the gain is from reconsidering, not from the extra call.

- Calls 1–3 are the primary arm's own step objects, and their outputs are copied from the primary arm's execution of the same scenario (`copied_from` on the step record) instead of being re-run. A control cell is held back until the primary arm has produced those parts, so run `full_flow_first_person` first.
- It does not run on `TIME_SENSITIVE` scenarios, where the primary arm skips its reappraisal. Stage 3 and Stage 4 show those cells as not applicable rather than as missing.
- Every Stage 3 step now records the tokens its call cost (`usage` on the step record), and the Stage 3 flow catalogue totals them per flow. Five calls do not make equal computation; report the tokens beside the scores.

`/api/export/episodes.csv` and `/api/export/episodes.json` download one row per episode with every flow's overall and dimension scores; the JSON adds the models used, episode counts and token usage per flow, and the control's part 4 and 5 prompts.

Stage 4 reports a paired comparison beside the means: each flow against a reference flow (the primary arm by default, selectable with `?vs=<flow_key>`), differences averaged within each person and then across persons, with a 95% confidence interval across persons.

## Evaluation

The judge scores five dimensions on a 1–10 integer scale. Four are judged from the predicted action: character consistency, situation fit, state/memory alignment, and action plausibility. One is judged from the flow's explanation: reasoning coherence, which also takes into account whether the explanation registers how much time the situation allowed and deliberates in proportion, and whether it accounts for the evidence that pulled against the action; neither is returned as a separate score. The questions and the meaning of each scale point are in `src/lib/stage-4.ts`. The overall score is the mean of the five, computed in code rather than reported by the model.

There is no gold action. The judge rates how well a predicted action is supported by the evaluation context, which is the same for every flow on a given scenario. Beside the consolidated context it also receives the Stage 2 episode blocks verbatim (relationship profiles, tendencies, current state, immediate memories, and reflective memories when the mode allows), so a detail the consolidation dropped cannot be scored as unsupported. It writes a short rationale before its scores; the rationale is stored with the evaluation and never aggregated.

## Generation settings

- Every stage uses the single model named by `OPENROUTER_MODEL`, called through OpenRouter.
- Reasoning effort is `low` for every call.
- Temperature is pinned to 0 for Stages 3 and 4. Stages 0–2 use the model's default.
- Every call requests a JSON object. Output that fails schema validation gets one corrective retry.
- Stages 0–3 run up to 8 requests concurrently. Stage 4 runs strictly one call at a time.
- `OPENROUTER_PROVIDERS` optionally restricts which providers may serve the model, with no fallback outside the list. Unset, OpenRouter chooses a provider per call.

## Setup

Requires Node.js 20 or later and an OpenRouter API key.

```bash
npm install
```

Copy `.env.example` to `.env` and set `OPENROUTER_API_KEY`. The other variables are documented in `.env.example`.

```bash
npm run dev
```

Open http://localhost:3000 and work through the stages in order: `/stage-0` to `/stage-4`. Each page starts its stage's run, shows progress, and lists the records produced so far.

Runs are resumable. Each model call is written to disk as it completes, and a later run with "skip existing" only makes the calls that are missing. A Stage 3 execution built from a scenario or description that has since been regenerated is treated as stale and rerun from its first step.

## Data layout

```
data/
  stage-1-config.json                                  Stage 1 settings
  stage-2-fields.json                                  Stage 2 settings and context sections
  profiles/<profile_id>.json                           Stage 0
  descriptions/<profile_id>.json                       Stage 1
  scenarios/<profile_id>/<scenario_id>.json            Stage 2
  executions/<profile_id>/<scenario_id>/<flow_key>.json    Stage 3
  evaluation-contexts/<profile_id>/<scenario_id>.json  Stage 4, part 1
  evaluations/<profile_id>/<scenario_id>/<flow_key>.json   Stage 4, part 2
  runs/<run_id>.json                                   One record per run, with its errors
```

Every generated record stores the model that produced it and when.

## Code layout

```
src/app/stage-N/          One page per stage
src/server/generation/    The stage runners
src/server/flows/         Flow definitions: prompts, output fields, prompt builders
src/server/llm/           The OpenRouter client
src/server/storage/       JSON file reads and writes
src/server/routers/       tRPC routers the pages call
src/lib/                  Schemas and types shared by server and pages
```

## Checks

```bash
npx tsc --noEmit
```

```bash
npm run lint
```
