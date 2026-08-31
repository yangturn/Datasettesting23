import type { Metadata } from "next";
import Link from "next/link";

import { GenerateScenarios } from "@/components/generate-scenarios";
import { NextStagePointer } from "@/components/stage-nav";
import { Pagination } from "@/components/ui/pagination";
import { pageFromParam, pageSizeFromParam } from "@/lib/pagination";
import { Section, Tag } from "@/components/ui/section";
import { getServerCaller } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Stage 2 · Episode Creation",
};

// Scenarios are written to disk by the generator, so this page must not be
// cached between runs.
export const dynamic = "force-dynamic";

export default async function Stage2Page(props: PageProps<"/stage-2">) {
  // The slice is taken in the router; this page only forwards the requested
  // page, and keeps its position in the query string.
  const { page, size } = await props.searchParams;
  const pageSize = pageSizeFromParam(size);

  const trpc = await getServerCaller();
  const [config, scenarios] = await Promise.all([
    trpc.scenarios.config(),
    trpc.scenarios.list({ page: pageFromParam(page), pageSize }),
  ]);

  const hrefFor = (target: number) => {
    const params = new URLSearchParams({
      page: String(target),
      size: String(pageSize),
    });
    return `/stage-2?${params}#scenarios`;
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
          Stage 2
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Episode Creation
        </h1>
        <p className="text-sm text-ink-muted">
          Each episode takes two model calls. The first puts a person from{" "}
          <Link href="/stage-1" className="text-accent hover:underline">
            Stage 1
          </Link>{" "}
          into a concrete situation and writes only that. The second is given the
          person and that situation, and extracts the facts it puts in play.
          Together they are the complete scenario ground truth Stage 3&apos;s flows
          read.
        </p>
      </header>

      <Section
        id="scenarios"
        title="Scenario"
        description={`Two calls per scenario. First, a short descriptive situation — external facts only — from the Stage 1 description alone, steered toward one of three situation types (normal, culture-relevant, or time-sensitive) cycled per person at a fixed 50/25/25 split. Then, given the person and that situation, up to ${config.contextMaxItems} items per field of decision-relevant context, one short sentence each, nothing the situation already says.`}
      >
        <div className="space-y-4">
          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <Tag>{config.situation.label} · call 1</Tag>
              {config.contextSections.map((section) => (
                <Tag key={section.key}>{section.label}</Tag>
              ))}
            </div>
            <p className="text-sm text-ink-subtle">
              The first tag is written alone; the rest are generated together in a
              second call that sees the person and the situation. Edit them and
              the per-field item cap in{" "}
              <code>data/stage-2-fields.json</code>.
            </p>
          </div>

          {scenarios.personCount === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
              No descriptions yet. Scenarios generate from{" "}
              <Link href="/stage-1" className="text-accent hover:underline">
                Stage 1
              </Link>
              &apos;s descriptions.
            </p>
          ) : (
            <>
              <GenerateScenarios
                personCount={scenarios.personCount}
                existingCount={scenarios.total}
                defaultPerPerson={config.defaultPerPerson}
                maxPerPerson={config.maxPerPerson}
                contextMaxItems={config.contextMaxItems}
                maxConcurrent={config.maxConcurrent}
              />

              {scenarios.total === 0 ? (
                <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
                  No scenarios yet. Run the generator above.
                </p>
              ) : (
                <>
                  <ul className="space-y-3">
                    {scenarios.rows.map((scenario) => (
                      <li
                        key={scenario.id}
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

                        {scenario.context_generated_at === null && (
                          <p className="text-sm text-danger">
                            The second call never finished — this scenario has a
                            situation but nothing around it. Run again to fill it
                            in.
                          </p>
                        )}

                        <div className="space-y-3">
                          {[
                            {
                              key: "__situation",
                              label: config.situation.label,
                              body: scenario.situation,
                              // Prose, so blank lines separate paragraphs. The
                              // context blocks are one fact per line instead.
                              prose: true,
                            },
                            ...config.contextSections.map((section) => ({
                              key: section.key,
                              label: section.label,
                              body: scenario.context[section.key],
                              prose: false,
                            })),
                          ].map((section) => {
                            const body = section.body;
                            if (!body) return null;

                            const parts = body
                              .split(section.prose ? /\n{2,}/ : /\n+/)
                              .map((part) => part.trim())
                              .filter((part) => part.length > 0);

                            return (
                              <details key={section.key}>
                                <summary className="cursor-pointer text-sm text-accent hover:underline">
                                  {section.label}
                                  {!section.prose && (
                                    <span className="ml-2 text-xs text-ink-subtle">
                                      {parts.length}
                                    </span>
                                  )}
                                </summary>
                                {section.prose ? (
                                  <div className="mt-2 space-y-2">
                                    {parts.map((paragraph, index) => (
                                      <p
                                        key={index}
                                        className="text-sm leading-relaxed text-ink"
                                      >
                                        {paragraph}
                                      </p>
                                    ))}
                                  </div>
                                ) : (
                                  <ul className="mt-2 space-y-1">
                                    {parts.map((fact, index) => (
                                      <li
                                        key={index}
                                        className="border-l-2 border-line-strong pl-3 text-sm leading-snug text-ink"
                                      >
                                        {fact}
                                      </li>
                                    ))}
                                  </ul>
                                )}
                              </details>
                            );
                          })}
                        </div>
                      </li>
                    ))}
                  </ul>

                  <Pagination
                    page={scenarios.page}
                    total={scenarios.total}
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

      <NextStagePointer
        stage="Stage 3"
        title="Flow Execution"
        description="Run each episode through every candidate character decision model."
        href="/stage-3"
      />
    </main>
  );
}
