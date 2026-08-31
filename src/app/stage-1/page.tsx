import type { Metadata } from "next";
import Link from "next/link";

import { GenerateDescriptions } from "@/components/generate-descriptions";
import { NextStagePointer } from "@/components/stage-nav";
import { Section } from "@/components/ui/section";
import { Pagination } from "@/components/ui/pagination";
import { pageFromParam, pageSizeFromParam } from "@/lib/pagination";
import { getServerCaller } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Stage 1 · Person / Population Creation",
};

// Descriptions are written to disk by the generator, so this page must not be
// cached between runs.
export const dynamic = "force-dynamic";

export default async function Stage1Page(props: PageProps<"/stage-1">) {
  // The slice is taken in the router; this page only forwards the requested
  // page, and keeps its position in the query string.
  const { page, size } = await props.searchParams;
  const pageSize = pageSizeFromParam(size);

  const trpc = await getServerCaller();
  const [descriptions, config] = await Promise.all([
    trpc.descriptions.list({ page: pageFromParam(page), pageSize }),
    trpc.descriptions.fields(),
  ]);

  const hrefFor = (target: number) => {
    const params = new URLSearchParams({
      page: String(target),
      size: String(pageSize),
    });
    return `/stage-1?${params}#descriptions`;
  };

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-10 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
          Stage 1
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Person / Population Creation
        </h1>
        <p className="text-sm text-ink-muted">
          Each short sketch from{" "}
          <Link href="/stage-0" className="text-accent hover:underline">
            Stage 0
          </Link>{" "}
          is expanded into a long description. That prose is the canonical text
          for this person — every later stage reads it rather than the sketch
          behind it, which is what makes comparing later methods meaningful.
        </p>
      </header>

      <Section
        id="descriptions"
        title="Long description"
        description={`Prose, roughly ${config.targetWordCount} words per person — the output is a person described, not a form filled in.`}
      >
        <div className="space-y-4">
          {descriptions.total === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
              No profiles exist yet. This stage generates from{" "}
              <Link href="/stage-0" className="text-accent hover:underline">
                Stage 0
              </Link>
              &apos;s output.
            </p>
          ) : (
            <>
              <GenerateDescriptions
                profileCount={descriptions.total}
                describedCount={descriptions.describedCount}
                targetWordCount={config.targetWordCount}
                maxConcurrent={config.maxConcurrent}
              />

              <p className="text-sm text-ink-subtle">
                {descriptions.describedCount} of {descriptions.total}{" "}
                {descriptions.total === 1 ? "profile" : "profiles"} described.
              </p>

              <ul className="space-y-3">
                {descriptions.rows.map((row) => (
                  <li
                    key={row.profileId}
                    className="space-y-3 rounded-lg border border-line bg-surface-raised p-4"
                  >
                    <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                      <span className="text-sm font-medium text-ink">
                        {row.name}
                      </span>
                      <span className="font-mono text-xs text-ink-subtle">
                        {row.profileId}
                      </span>
                    </div>
                    <p className="text-sm text-ink-muted">{row.headline}</p>

                    {row.stale && (
                      <p className="text-sm text-danger">
                        This description was written from a different profile
                        that previously held this id — Stage 0 was regenerated
                        since. Regenerate to replace it.
                      </p>
                    )}

                    {row.description === null ? (
                      <p className="text-sm text-ink-subtle">
                        No description yet.
                      </p>
                    ) : (
                      <details>
                        <summary className="cursor-pointer text-sm text-accent hover:underline">
                          {row.description.description
                            .split(/\s+/)
                            .length.toLocaleString()}{" "}
                          words · show description
                        </summary>
                        <div className="mt-3 space-y-3">
                          {row.description.description
                            .split(/\n{2,}/)
                            .map((paragraph, index) => (
                              <p
                                key={index}
                                className="text-sm leading-relaxed text-ink"
                              >
                                {paragraph.trim()}
                              </p>
                            ))}
                        </div>
                      </details>
                    )}
                  </li>
                ))}
              </ul>

              <Pagination
                page={descriptions.page}
                total={descriptions.total}
                pageSize={pageSize}
                unit="profiles"
                pageParams={["page"]}
                hrefFor={hrefFor}
              />
            </>
          )}
        </div>
      </Section>

      <NextStagePointer
        stage="Stage 2"
        title="Episode Creation"
        description="Place each person in concrete situations to produce scenario ground truth."
        href="/stage-2"
      />
    </main>
  );
}
