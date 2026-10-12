import type { Metadata } from "next";
import Link from "next/link";

import { RunEvaluations } from "@/components/run-evaluations";
import { Pagination } from "@/components/ui/pagination";
import { Section, Tag } from "@/components/ui/section";
import { pageFromParam, pageSizeFromParam } from "@/lib/pagination";
import {
  EVALUATION_CONTEXT_FIELDS,
  SCORE_DIMENSIONS,
  SCORE_SCALE,
  SITUATION_FILTERS,
  SITUATION_FILTER_LABELS,
  situationFilterFromParam,
  situationTypesFor,
} from "@/lib/stage-4";
import { cn } from "@/lib/utils";
import { getServerCaller } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Stage 4 · Evaluation",
};

// Scores are written to disk by the runner, so this page must not be cached
// between runs.
export const dynamic = "force-dynamic";

/** A written account: blank lines separate paragraphs. */
function splitParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** Two decimals, but only when they carry information. */
function formatScore(value: number): string {
  return Number.isInteger(value) ? value.toFixed(1) : value.toFixed(2);
}

export default async function Stage4Page(props: PageProps<"/stage-4">) {
  // The slice is taken in the router; this page only forwards the requested
  // page, and keeps its position in the query string.
  const { page, size, type, vs } = await props.searchParams;
  const pageSize = pageSizeFromParam(size);
  const filter = situationFilterFromParam(type);
  // The router takes situation types, not chips: `ALL` is the absence of a
  // filter, and a grouped chip is several types at once.
  const situationTypes = situationTypesFor(filter);
  // The flow the paired comparison is taken against. Validated by the router,
  // which falls back to the first flow for an unknown key.
  const reference = Array.isArray(vs) ? vs[0] : vs;

  const trpc = await getServerCaller();
  const [coverage, scoreboard, listing] = await Promise.all([
    trpc.evaluations.coverage(),
    trpc.evaluations.scoreboard({ situationTypes, reference }),
    trpc.evaluations.list({
      page: pageFromParam(page),
      pageSize,
      situationTypes,
    }),
  ]);

  /** Keeps the filter, reference flow and page size in the URL alongside the page number. */
  const urlFor = (params: {
    page?: number;
    type?: string;
    vs?: string;
    anchor?: string;
  }) => {
    const query = new URLSearchParams({ size: String(pageSize) });
    if (params.page !== undefined) query.set("page", String(params.page));
    const nextType = params.type ?? filter;
    if (nextType !== "ALL") query.set("type", nextType);
    const nextReference = params.vs ?? scoreboard.reference.key;
    if (nextReference !== scoreboard.defaultReference) {
      query.set("vs", nextReference);
    }
    return `/stage-4?${query}#${params.anchor ?? "detail"}`;
  };

  const hrefFor = (target: number) => urlFor({ page: target });

  /** A signed difference with its interval, e.g. "+0.31 [+0.12, +0.50]". */
  const formatDifference = (value: number) =>
    `${value >= 0 ? "+" : "−"}${Math.abs(value).toFixed(2)}`;

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="max-w-3xl space-y-2">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
          Stage 4
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Evaluation
        </h1>
        <p className="text-sm text-ink-muted">
          Scoring what{" "}
          <Link href="/stage-3" className="text-accent hover:underline">
            Stage 3
          </Link>
          &apos;s flows predicted, in two parts. Part 1 consolidates the ground
          truth into a neutral account, without seeing any flow&apos;s output —
          one per scenario, shared by every flow. Part 2 scores each
          flow&apos;s predicted action and its explanation against it, and
          against the Stage 2 episode blocks verbatim, on{" "}
          {SCORE_DIMENSIONS.length} dimensions, writing a short rationale
          before the scores.
        </p>
      </header>

      <Section
        title="Scoreboard"
        description={`Mean scores per flow, 1 to ${scoreboard.scaleMax}, over ${scoreboard.scored} ${
          scoreboard.scored === 1 ? "evaluation" : "evaluations"
        }${filter === "ALL" ? "" : ` in ${SITUATION_FILTER_LABELS[filter]} situations`}. ${coverage.scoresDone} of ${coverage.scorable} scorable predictions judged in total.`}
      >
        {scoreboard.superseded > 0 && (
          <p className="rounded-lg border border-line-strong bg-surface p-3 text-sm text-ink-muted">
            {scoreboard.superseded}{" "}
            {scoreboard.superseded === 1 ? "evaluation was" : "evaluations were"}{" "}
            scored on a superseded scale, set of dimensions, or scoring rules,
            and{" "}
            {scoreboard.superseded === 1 ? "is" : "are"} left out of these
            averages — a 4 out of 5 and a 4 out of 10 are different judgements,
            and so are two 4s answering different questions. Re-run the
            evaluator below to score{" "}
            {scoreboard.superseded === 1 ? "it" : "them"} on the current
            1–{scoreboard.scaleMax} scale and rules.
          </p>
        )}
        {/* Situation type is the cut that matters here: TIME_SENSITIVE forces
            the evaluator into IMMEDIATE mode, so it is precisely where
            reflection cannot help, and an average over all three types hides
            that. "Normal + Culture" is the other side of it: the situations
            that did run in REFLECTION_AVAILABLE mode, pooled. Links rather
            than a client control — the filter belongs in the URL beside the
            page and size, and the page is server-rendered. */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-subtle">Situation</span>
          {SITUATION_FILTERS.map((option) => {
            // Counted from the per-type totals, so a grouped chip adds its
            // members up rather than needing a count of its own.
            const types = situationTypesFor(option);
            const count = (types ?? Object.keys(scoreboard.byType)).reduce(
              (total, type) => total + (scoreboard.byType[type] ?? 0),
              0,
            );

            return (
              <Link
                key={option}
                href={urlFor({ page: 1, type: option })}
                className={cn(
                  "rounded-md border px-2.5 py-1 text-sm",
                  option === filter
                    ? "border-accent bg-surface-raised text-accent"
                    : "border-line-strong text-ink-muted hover:border-accent hover:text-accent",
                )}
              >
                {SITUATION_FILTER_LABELS[option]}
                <span className="ml-1.5 text-xs text-ink-subtle">{count}</span>
              </Link>
            );
          })}
        </div>

        {scoreboard.scored === 0 ? (
          filter === "ALL" ? (
            <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
              Nothing scored yet. Run the evaluator below.
            </p>
          ) : (
            <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
              No {SITUATION_FILTER_LABELS[filter]} situations scored yet.
            </p>
          )
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  <th className="py-2 pr-4 font-medium">Flow</th>
                  <th className="py-2 pr-4 font-medium">Overall</th>
                  {SCORE_DIMENSIONS.map((dimension) => (
                    <th
                      key={dimension.key}
                      className="py-2 pr-4 font-medium whitespace-nowrap"
                    >
                      {dimension.label}
                    </th>
                  ))}
                  <th className="py-2 font-medium">Scored</th>
                </tr>
              </thead>
              <tbody>
                {scoreboard.flows.map((flow) => (
                  <tr key={flow.key} className="border-b border-line">
                    <td className="py-2 pr-4 font-medium text-ink">
                      {flow.label}
                    </td>
                    <td className="py-2 pr-4 text-ink">
                      {flow.overall === null
                        ? "—"
                        : formatScore(flow.overall)}
                    </td>
                    {SCORE_DIMENSIONS.map((dimension) => {
                      const value = flow.dimensions[dimension.key] ?? null;
                      return (
                        <td
                          key={dimension.key}
                          className="py-2 pr-4 text-ink-muted"
                        >
                          {value === null ? "—" : formatScore(value)}
                        </td>
                      );
                    })}
                    <td className="py-2 text-ink-subtle">{flow.scored}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-sm text-ink-subtle">
          Overall is the mean of the {SCORE_DIMENSIONS.length} dimensions,
          computed here rather than asked for — a model that reports its own
          average gets to disagree with its own scores.
        </p>
      </Section>

      {/* The comparison the means above cannot make on their own. Two flows
          answer the same scenarios, so the honest question is the paired one:
          per scenario, how much higher does one score than the other — averaged
          within each person, since one biography's episodes are not
          independent of each other, and then across persons, which is the unit
          the interval is taken over. */}
      <Section
        id="paired"
        title="Paired differences"
        description={`Each flow against ${scoreboard.reference.label}, on the scenarios both have scored${filter === "ALL" ? "" : ` in ${SITUATION_FILTER_LABELS[filter]} situations`}. The difference is reference minus flow, averaged within each person and then across persons; the interval is a 95% confidence interval across persons (Student's t). A positive difference favours the reference.`}
      >
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-subtle">Reference</span>
          {coverage.flows.map((flow) => (
            <Link
              key={flow.key}
              href={urlFor({ page: 1, vs: flow.key, anchor: "paired" })}
              className={cn(
                "rounded-md border px-2.5 py-1 text-sm",
                flow.key === scoreboard.reference.key
                  ? "border-accent bg-surface-raised text-accent"
                  : "border-line-strong text-ink-muted hover:border-accent hover:text-accent",
              )}
            >
              {flow.label}
            </Link>
          ))}
        </div>

        {scoreboard.paired.every((flow) => flow.overall === null) ? (
          <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
            No scenario has been scored by both {scoreboard.reference.label}{" "}
            and another flow yet.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-ink-muted">
                  <th className="py-2 pr-4 font-medium">Flow</th>
                  <th className="py-2 pr-4 font-medium whitespace-nowrap">
                    Overall Δ [95% CI]
                  </th>
                  {SCORE_DIMENSIONS.map((dimension) => (
                    <th
                      key={dimension.key}
                      className="py-2 pr-4 font-medium whitespace-nowrap"
                    >
                      {dimension.label}
                    </th>
                  ))}
                  <th className="py-2 pr-4 font-medium">Persons</th>
                  <th className="py-2 font-medium">Pairs</th>
                </tr>
              </thead>
              <tbody>
                {scoreboard.paired.map((flow) => (
                  <tr key={flow.key} className="border-b border-line">
                    <td className="py-2 pr-4 font-medium text-ink">
                      {flow.label}
                    </td>
                    <td className="py-2 pr-4 whitespace-nowrap text-ink">
                      {flow.overall === null ? (
                        "—"
                      ) : (
                        <>
                          {formatDifference(flow.overall.mean)}{" "}
                          <span className="text-ink-subtle">
                            [{formatDifference(flow.overall.lower)},{" "}
                            {formatDifference(flow.overall.upper)}]
                          </span>
                        </>
                      )}
                    </td>
                    {SCORE_DIMENSIONS.map((dimension) => {
                      const value = flow.dimensions[dimension.key] ?? null;
                      return (
                        <td
                          key={dimension.key}
                          className="py-2 pr-4 whitespace-nowrap text-ink-muted"
                        >
                          {value === null ? (
                            "—"
                          ) : (
                            <>
                              {formatDifference(value.mean)}{" "}
                              <span className="text-ink-subtle">
                                [{formatDifference(value.lower)},{" "}
                                {formatDifference(value.upper)}]
                              </span>
                            </>
                          )}
                        </td>
                      );
                    })}
                    <td className="py-2 pr-4 text-ink-subtle">
                      {flow.overall?.persons ?? "—"}
                    </td>
                    <td className="py-2 text-ink-subtle">
                      {flow.overall?.pairs ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        <p className="text-sm text-ink-subtle">
          An interval that excludes zero is a difference the data supports at
          the 95% level. One person yields a point with no interval; the
          interval is only as wide as the number of persons makes it, so a
          handful of people gives a wide one however many episodes each has.
        </p>

        {/* The episode-level table these intervals are computed from, for
            anyone who wants to compute their own. Means cannot be unpacked
            into pairs; the rows can. */}
        <p className="text-sm text-ink-muted">
          Episode-level scores for every flow:{" "}
          <a href="/api/export/episodes.csv" className="text-accent hover:underline">
            episodes.csv
          </a>{" "}
          or{" "}
          <a href="/api/export/episodes.json" className="text-accent hover:underline">
            episodes.json
          </a>
          . The JSON also carries the models used, episode counts and token
          usage per flow, and the prompts of the control&apos;s own parts.
        </p>
      </Section>

      <Section
        id="detail"
        title={
          filter === "ALL"
            ? "Per scenario"
            : `Per scenario · ${SITUATION_FILTER_LABELS[filter]}`
        }
        description={`${coverage.contextsDone} of ${coverage.scenarioCount} contexts built. A TIME_SENSITIVE situation had to be answered on the spot, so its context is built in IMMEDIATE mode with reflective memories withheld; every other situation type gets both memory blocks.`}
      >
        <div className="space-y-4">
          {coverage.scenarioCount === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
              No runnable scenarios yet. Evaluation runs against{" "}
              <Link href="/stage-2" className="text-accent hover:underline">
                Stage 2
              </Link>
              &apos;s scenarios, once their episode context exists.
            </p>
          ) : (
            <>
              <RunEvaluations scenarioCount={coverage.scenarioCount} />

              {coverage.unpredicted > 0 && (
                <p className="text-sm text-ink-muted">
                  {coverage.unpredicted}{" "}
                  {coverage.unpredicted === 1 ? "cell has" : "cells have"} no{" "}
                  <Link href="/stage-3" className="text-accent hover:underline">
                    Stage 3
                  </Link>{" "}
                  prediction to score — those flows have not reached their
                  decision step yet.
                </p>
              )}

              {coverage.contextsDone === 0 ? (
                <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
                  No contexts built yet. Start the evaluator above.
                </p>
              ) : listing.total === 0 ? (
                // Reachable only under a filter: the rows exist, just none of
                // this situation type. Says so rather than leaving a gap.
                <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
                  No {SITUATION_FILTER_LABELS[filter]} situations.{" "}
                  <Link
                    href={urlFor({ page: 1, type: "ALL" })}
                    className="text-accent hover:underline"
                  >
                    Show all situations
                  </Link>
                  .
                </p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {listing.rows.map(
                      ({ scenario, mode, context, contextStale, scores }) => (
                        <li
                          key={`${scenario.profile_id}/${scenario.id}`}
                          className="space-y-3 rounded-lg border border-line bg-surface-raised p-4"
                        >
                          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                            <span className="text-sm font-medium text-ink">
                              {scenario.title}
                            </span>
                            <span className="font-mono text-xs text-ink-subtle">
                              {scenario.profile_id}
                            </span>
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <span className="text-sm text-ink-muted">
                              {scenario.name}
                            </span>
                            <Tag>{scenario.situation_type}</Tag>
                            <Tag>
                              {mode}
                              {mode === "IMMEDIATE"
                                ? " · reflective memories withheld"
                                : " · both memory blocks"}
                            </Tag>
                          </div>

                          {contextStale && (
                            <p className="text-sm text-danger">
                              Context built from a scenario, biography, or
                              decision mode that has since changed — run again to
                              replace it.
                            </p>
                          )}

                          {/* Scores first: the context below is the evidence
                              they were reached from, not the finding. */}
                          <div
                            className="grid gap-3"
                            style={{
                              gridTemplateColumns:
                                "repeat(auto-fit, minmax(15rem, 1fr))",
                            }}
                          >
                            {scores.map(
                              ({
                                flowKey,
                                flowLabel,
                                applicable,
                                evaluation,
                                stale,
                              }) => (
                                <div
                                  key={flowKey}
                                  className="space-y-2 rounded-lg border border-line bg-surface p-3"
                                >
                                  <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                    <span className="text-sm font-medium text-ink">
                                      {flowLabel}
                                    </span>
                                    {evaluation && (
                                      <span className="text-sm font-medium text-accent">
                                        {formatScore(evaluation.overall_score)}
                                      </span>
                                    )}
                                  </div>

                                  {!applicable ? (
                                    <p className="text-sm text-ink-subtle">
                                      Not run on {scenario.situation_type}{" "}
                                      scenarios, so nothing to score.
                                    </p>
                                  ) : evaluation === null ? (
                                    <p className="text-sm text-ink-subtle">
                                      Not scored yet.
                                    </p>
                                  ) : (
                                    <>
                                      {stale && (
                                        <p className="text-sm text-danger">
                                          Scored against an older context,
                                          scale, dimensions, or scoring rules.
                                        </p>
                                      )}
                                      <dl className="space-y-1">
                                        {SCORE_DIMENSIONS.map((dimension) => {
                                          const value =
                                            evaluation.scores[dimension.key];
                                          return (
                                            <div
                                              key={dimension.key}
                                              className="flex items-baseline justify-between gap-3"
                                            >
                                              <dt
                                                className="text-sm text-ink-muted"
                                                title={dimension.question}
                                              >
                                                {dimension.label}
                                              </dt>
                                              <dd
                                                className="text-sm text-ink"
                                                title={
                                                  value === undefined
                                                    ? undefined
                                                    : SCORE_SCALE[value]
                                                }
                                              >
                                                {value ?? "—"}
                                              </dd>
                                            </div>
                                          );
                                        })}
                                      </dl>
                                      <details>
                                        <summary className="cursor-pointer text-sm text-accent hover:underline">
                                          Action scored
                                        </summary>
                                        <p className="mt-2 text-sm leading-relaxed text-ink">
                                          {evaluation.action}
                                        </p>
                                      </details>
                                      {/* Shown beside the action because it is
                                          now scored too — reasoning_coherence
                                          judges this text, so hiding it would
                                          leave a number with no source. */}
                                      <details>
                                        <summary className="cursor-pointer text-sm text-accent hover:underline">
                                          Reason scored
                                          {evaluation.reason === "" && (
                                            <span className="ml-1.5 text-xs text-ink-subtle">
                                              none
                                            </span>
                                          )}
                                        </summary>
                                        <p className="mt-2 text-sm leading-relaxed text-ink">
                                          {evaluation.reason === ""
                                            ? "This evaluation was made before the reason was judged, or the flow gave none."
                                            : evaluation.reason}
                                        </p>
                                      </details>
                                      {/* The judge's own account of its
                                          numbers. Absent on evaluations made
                                          before it was asked for one. */}
                                      {evaluation.rationale !== "" && (
                                        <details>
                                          <summary className="cursor-pointer text-sm text-accent hover:underline">
                                            Judge rationale
                                          </summary>
                                          <p className="mt-2 text-sm leading-relaxed text-ink">
                                            {evaluation.rationale}
                                          </p>
                                        </details>
                                      )}
                                    </>
                                  )}
                                </div>
                              ),
                            )}
                          </div>

                          {context === null ? (
                            <p className="text-sm text-ink-subtle">
                              Context not built yet.
                            </p>
                          ) : (
                            <div className="space-y-1">
                              {EVALUATION_CONTEXT_FIELDS.map((field) => {
                                const body = context[field.key]?.trim() ?? "";

                                return (
                                  <details key={field.key}>
                                    <summary className="cursor-pointer text-sm text-accent hover:underline">
                                      {field.label}
                                      {body === "" && (
                                        <span className="ml-2 text-xs text-ink-subtle">
                                          empty
                                        </span>
                                      )}
                                    </summary>
                                    <div className="mt-2 space-y-2">
                                      {splitParagraphs(body).map(
                                        (paragraph, index) => (
                                          <p
                                            key={index}
                                            className="text-sm leading-relaxed text-ink"
                                          >
                                            {paragraph}
                                          </p>
                                        ),
                                      )}
                                    </div>
                                  </details>
                                );
                              })}
                            </div>
                          )}
                        </li>
                      ),
                    )}
                  </ul>

                  <Pagination
                    page={listing.page}
                    total={listing.total}
                    pageSize={pageSize}
                    unit="scenarios"
                    pageParams={["page"]}
                    hrefFor={hrefFor}
                  />
                </>
              )}
            </>
          )}
        </div>
      </Section>
    </main>
  );
}
