import Link from "next/link";
import type { Metadata } from "next";

import { GenerateDigitalTwinPersonas } from "@/components/generate-digital-twin-personas";
import { NextStagePointer } from "@/components/stage-nav";
import { Pagination } from "@/components/ui/pagination";
import { pageFromParam, pageSizeFromParam } from "@/lib/pagination";
import { getServerCaller } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Stage 1 · Digital Twin Personas",
};

export const dynamic = "force-dynamic";

export default async function DigitalTwinStage1Page(
  props: PageProps<"/digital-twins/stage-1">,
) {
  const { page: pageParam, size } = await props.searchParams;
  const pageSize = pageSizeFromParam(size);
  const trpc = await getServerCaller();
  const [list, config] = await Promise.all([
    trpc.digitalTwins.stage1List({
      page: pageFromParam(pageParam),
      pageSize,
    }),
    trpc.digitalTwins.stage1Config(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
          Digital Twins · Stage 1
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Person / Population Creation
        </h1>
        <p className="text-sm text-ink-muted">
          Convert each participant&apos;s non-held-out Waves 1–3 responses into an
          evidence-grounded narrative and structured behavioral profile. The raw
          transcript remains linked for question-specific retrieval later.
        </p>
      </header>

      {list.selection === null ? (
        <div className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
          Select participants in{" "}
          <Link href="/digital-twins/stage-0" className="text-accent hover:underline">
            Stage 0
          </Link>{" "}
          before generating personas.
        </div>
      ) : (
        <>
          <GenerateDigitalTwinPersonas
            profileCount={list.selection.selectedCount}
            generatedCount={list.generatedCount}
            targetNarrativeWords={config.targetNarrativeWords}
            maxConcurrent={config.maxConcurrent}
          />

          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-ink-muted">
            <span>{list.generatedCount} of {list.selection.selectedCount} generated</span>
            <span className="font-mono text-xs text-ink-subtle">
              {list.selection.id}
            </span>
          </div>

          <ul className="space-y-3">
            {list.rows.map((row) => (
              <li
                key={row.profileId}
                className="space-y-3 rounded-lg border border-line bg-surface-raised p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-3">
                  <p className="text-sm font-medium text-ink">
                    Participant {row.participantId}
                  </p>
                  <span className="font-mono text-xs text-ink-subtle">
                    {row.profileId}
                  </span>
                </div>
                {row.persona ? (
                  <>
                    <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink">
                      {row.persona.narrative}
                    </p>
                    <p className="text-xs text-ink-subtle">
                      {row.claimCount} evidence-grounded claims · {row.persona.model}
                    </p>
                  </>
                ) : (
                  <p className="text-sm text-ink-muted">Awaiting generation.</p>
                )}
              </li>
            ))}
          </ul>

          <Pagination
            page={list.page}
            total={list.total}
            pageSize={pageSize}
            unit="personas"
            pageParams={["page"]}
            hrefFor={(target) =>
              `/digital-twins/stage-1?page=${target}&size=${pageSize}`
            }
          />
        </>
      )}

      <NextStagePointer
        stage="Stage 2"
        title="Episode Creation"
        description="Build decision context from the generated persona and its source evidence."
      />
    </main>
  );
}

