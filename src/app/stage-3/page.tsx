import type { Metadata } from "next";
import Link from "next/link";

import { RunFlows } from "@/components/run-flows";
import { NextStagePointer } from "@/components/stage-nav";
import { Pagination } from "@/components/ui/pagination";
import { Section, Tag } from "@/components/ui/section";
import { pageFromParam, pageSizeFromParam } from "@/lib/pagination";
import { getServerCaller } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Stage 3 · Flow Execution",
};

// Executions are written to disk by the runner, so this page must not be
// cached between runs.
export const dynamic = "force-dynamic";

/** An extraction field: one short statement per line. */
function splitFacts(body: string): string[] {
  return body
    .split(/\n+/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/** A written account: blank lines separate paragraphs. */
function splitParagraphs(body: string): string[] {
  return body
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

/**
 * The consolidation prompt asks for its three sections as headings inside one
 * string, so they arrive as short all-caps paragraphs. Recognised here rather
 * than parsed for: a heading that does not match simply renders as prose, which
 * is what it is.
 */
function isHeading(paragraph: string): boolean {
  return (
    paragraph.length <= 80 &&
    /[A-Z]/.test(paragraph) &&
    paragraph === paragraph.toUpperCase()
  );
}

export default async function Stage3Page(props: PageProps<"/stage-3">) {
  // The slice is taken in the router; this page only forwards the requested
  // page, and keeps its position in the query string.
  const { page, size } = await props.searchParams;
  const pageSize = pageSizeFromParam(size);

  const trpc = await getServerCaller();
  const [config, coverage, grid] = await Promise.all([
    trpc.executions.config(),
    trpc.executions.coverage(),
    trpc.executions.list({ page: pageFromParam(page), pageSize }),
  ]);

  const hrefFor = (target: number) => {
    const params = new URLSearchParams({
      page: String(target),
      size: String(pageSize),
    });
    return `/stage-3?${params}#grid`;
  };

  const totalSteps = coverage.flows.reduce(
    (total, flow) => total + flow.totalSteps,
    0,
  );
  const doneSteps = coverage.flows.reduce(
    (total, flow) => total + flow.doneSteps,
    0,
  );

  // Wider than the other stages: a row here is one situation across every flow,
  // read across rather than down, so the columns need the room.
  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="max-w-3xl space-y-2">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
          Stage 3
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Flow Execution
        </h1>
        <p className="text-sm text-ink-muted">
          Every scenario from{" "}
          <Link href="/stage-2" className="text-accent hover:underline">
            Stage 2
          </Link>{" "}
          is run through each candidate character decision model. A flow is a
          pipeline, not a prompt: it runs in parts, one model call each, and
          every part is handed what the parts before it produced. Running them
          all against identical input is what makes the flows comparable.
        </p>
      </header>

      <Section
        id="grid"
        title="Flows"
        description={`${config.flows.length} ${
          config.flows.length === 1 ? "flow" : "flows"
        } over ${coverage.scenarioCount} ${
          coverage.scenarioCount === 1 ? "scenario" : "scenarios"
        } — ${totalSteps} model calls in total, ${doneSteps} of them done. Parts are written to disk as they land, so a flow that fails halfway keeps what it already produced and resumes there.`}
      >
        <div className="space-y-4">
          {/* The runner comes first. The catalogue below it grows by a block
              every time a part is added to a flow, and when it led the section
              it pushed the only controls on the page off the bottom of it. */}
          {coverage.scenarioCount === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
              No runnable scenarios yet. Flows run against{" "}
              <Link href="/stage-2" className="text-accent hover:underline">
                Stage 2
              </Link>
              &apos;s scenarios, and only once their second call has written the
              episode context.
            </p>
          ) : (
            <>
              <RunFlows
                flows={coverage.flows}
                scenarioCount={coverage.scenarioCount}
                maxConcurrent={config.maxConcurrent}
              />

              {grid.incompleteCount > 0 && (
                <p className="text-sm text-ink-muted">
                  {grid.incompleteCount} half-generated{" "}
                  {grid.incompleteCount === 1 ? "scenario is" : "scenarios are"}{" "}
                  left out — Stage 2 wrote the situation but never the context
                  around it. Re-run{" "}
                  <Link href="/stage-2" className="text-accent hover:underline">
                    Stage 2
                  </Link>{" "}
                  to finish {grid.incompleteCount === 1 ? "it" : "them"}.
                </p>
              )}

              {grid.missingBiographyCount > 0 && (
                <p className="text-sm text-ink-muted">
                  {grid.missingBiographyCount}{" "}
                  {grid.missingBiographyCount === 1 ? "scenario" : "scenarios"}{" "}
                  left out for having no{" "}
                  <Link href="/stage-1" className="text-accent hover:underline">
                    Stage 1
                  </Link>{" "}
                  description — the biography is the flows&apos; primary input.
                </p>
              )}

              {doneSteps === 0 ? (
                <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
                  Nothing has run yet. Start the flows above.
                </p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {grid.rows.map(({ scenario, cells, orphaned }) => (
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
                        <p className="text-sm text-ink-muted">
                          {scenario.name} · {scenario.situation_type}
                          {/* Null on scenarios generated before life domains
                              existed — omitted rather than shown as a blank. */}
                          {scenario.life_domain !== null &&
                            ` · ${scenario.life_domain}`}
                        </p>

                        <details>
                          <summary className="cursor-pointer text-sm text-accent hover:underline">
                            Situation
                          </summary>
                          <p className="mt-2 text-sm leading-relaxed text-ink">
                            {scenario.situation}
                          </p>
                        </details>

                        {/* The flows sit side by side, one column each: the row
                            is a comparison, and stacked cells put the thing
                            being compared a scroll apart. The negative margin
                            lets the scroll area bleed to the card's edge so a
                            column ends flush rather than clipped mid-padding. */}
                        <div className="-mx-4 overflow-x-auto px-4 pb-1">
                          <div className="flex items-stretch gap-3">
                            {cells.map((cell) => (
                              <div
                                key={cell.flowKey}
                                /* min-w over a fixed width: two flows split the
                                   page, more of them scroll rather than shrink
                                   into unreadable strips. */
                                className="flex min-w-[19rem] flex-1 flex-col gap-3 rounded-lg border border-line bg-surface p-3"
                              >
                                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                                  <span className="text-sm font-medium text-ink">
                                    {cell.flowLabel}
                                  </span>
                                  <span className="text-xs text-ink-subtle">
                                    {cell.doneSteps} of {cell.stepCount}{" "}
                                    {cell.stepCount === 1 ? "part" : "parts"}
                                  </span>
                                </div>

                                {cell.stale && (
                                  <p className="text-sm text-danger">
                                    Built from a scenario or biography that has
                                    since changed — run again to replace it.
                                  </p>
                                )}

                                {/* The flow's actual claim, above the parts that
                                    produced it. Everything else is working — this
                                    is the answer, and it is the one thing you
                                    should not have to expand a section to read. */}
                                {cell.outcome !== null && (
                                  <div className="space-y-1 rounded-lg border border-accent/40 bg-surface-raised p-3">
                                    <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
                                      {cell.outcomeLabel ?? "Outcome"}
                                    </p>
                                    <p className="text-sm leading-relaxed text-ink">
                                      {cell.outcome}
                                    </p>
                                  </div>
                                )}

                                {cell.doneSteps === 0 ? (
                                  <p className="text-sm text-ink-subtle">
                                    Not run yet.
                                  </p>
                                ) : (
                                  <ol className="space-y-3">
                                    {cell.steps.map((step, index) => (
                                      <li key={step.key} className="space-y-2">
                                        <div className="flex flex-wrap items-baseline gap-x-2">
                                          <span className="text-sm font-medium text-ink">
                                            Part {index + 1}
                                          </span>
                                          <span className="text-sm text-ink-muted">
                                            {step.label}
                                          </span>
                                        </div>

                                        {step.output === null ? (
                                          <p className="text-sm text-ink-subtle">
                                            Not run yet.
                                          </p>
                                        ) : (
                                          step.fields.map((field) => {
                                            const body =
                                              step.output?.[
                                                field.key
                                              ]?.trim() ?? "";

                                            // A closed-set verdict is the most
                                            // scannable thing a step produces,
                                            // so it sits inline rather than
                                            // behind a disclosure triangle.
                                            if (field.render === "value") {
                                              return (
                                                <div
                                                  key={field.key}
                                                  className="flex flex-wrap items-baseline gap-x-2"
                                                >
                                                  <span className="text-sm text-ink-muted">
                                                    {field.label}
                                                  </span>
                                                  <Tag>{body || "—"}</Tag>
                                                </div>
                                              );
                                            }

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
                                                {body === "" ? (
                                                  <p className="mt-2 text-sm text-ink-subtle">
                                                    {/* The prompts allow a blank
                                                        field where the biography
                                                        gives no evidence — shown as
                                                        such, not hidden. */}
                                                    No supported attributes for
                                                    this field.
                                                  </p>
                                                ) : field.render === "prose" ? (
                                                  <div className="mt-2 space-y-2">
                                                    {splitParagraphs(body).map(
                                                      (paragraph, itemIndex) =>
                                                        isHeading(paragraph) ? (
                                                          <p
                                                            key={itemIndex}
                                                            className="pt-1 text-xs font-semibold tracking-wide text-ink-muted uppercase"
                                                          >
                                                            {paragraph}
                                                          </p>
                                                        ) : (
                                                          <p
                                                            key={itemIndex}
                                                            className="text-sm leading-relaxed text-ink"
                                                          >
                                                            {paragraph}
                                                          </p>
                                                        ),
                                                    )}
                                                  </div>
                                                ) : (
                                                  <ul className="mt-2 space-y-1">
                                                    {splitFacts(body).map(
                                                      (item, itemIndex) => (
                                                        <li
                                                          key={itemIndex}
                                                          className="border-l-2 border-line-strong pl-3 text-sm leading-snug text-ink"
                                                        >
                                                          {item}
                                                        </li>
                                                      ),
                                                    )}
                                                  </ul>
                                                )}
                                              </details>
                                            );
                                          })
                                        )}
                                      </li>
                                    ))}
                                  </ol>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>

                        {orphaned > 0 && (
                          <p className="text-sm text-ink-subtle">
                            {orphaned}{" "}
                            {orphaned === 1 ? "execution" : "executions"} on
                            disk for {orphaned === 1 ? "a flow" : "flows"}{" "}
                            <code>src/server/flows/</code> no longer defines —
                            kept, not shown.
                          </p>
                        )}
                      </li>
                    ))}
                  </ul>

                  <Pagination
                    page={grid.page}
                    total={grid.total}
                    pageSize={pageSize}
                    unit="scenarios"
                    pageParams={["page"]}
                    hrefFor={hrefFor}
                  />
                </>
              )}
            </>
          )}

          {/* Reference, not a control — collapsed, since it gains a block per
              part and the same parts are named on every execution below. The
              summary carries the shape so it is worth reading closed. */}
          {config.flows.map((flow) => (
            <details
              key={flow.key}
              className="rounded-lg border border-line bg-surface p-3"
            >
              <summary className="cursor-pointer text-sm text-ink-muted">
                <span className="font-medium text-ink">{flow.label}</span>
                {" · "}
                {flow.steps.length} {flow.steps.length === 1 ? "part" : "parts"}
                : {flow.steps.map((step) => step.label).join(" → ")}
              </summary>

              <div className="mt-3 space-y-3">
                <p className="text-sm text-ink-muted">{flow.description}</p>

                <ol className="space-y-2">
                  {flow.steps.map((step, index) => (
                    <li key={step.key} className="space-y-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="text-sm font-medium text-ink">
                          Part {index + 1}
                        </span>
                        <span className="text-sm text-ink-muted">
                          {step.label}
                        </span>
                      </div>
                      <p className="text-sm text-ink-subtle">
                        {step.description}
                      </p>
                      <div className="flex flex-wrap gap-2">
                        {step.fields.map((field) => (
                          <Tag key={field.key}>{field.label}</Tag>
                        ))}
                      </div>
                    </li>
                  ))}
                </ol>

                <p className="text-sm text-ink-subtle">
                  Defined in <code>src/server/flows/</code> — a part is a system
                  prompt, its output fields, and a prompt builder that reads the
                  earlier parts, which is more than a JSON config can hold.
                </p>
              </div>
            </details>
          ))}
        </div>
      </Section>

      <NextStagePointer
        stage="Stage 4"
        title="Evaluation"
        description="Consolidate the ground truth into a neutral context, then score each flow's prediction against it."
        href="/stage-4"
      />
    </main>
  );
}
