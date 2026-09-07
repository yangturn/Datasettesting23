import type { Metadata } from "next";
import Link from "next/link";

import { RunDigitalTwinFlows } from "@/components/run-digital-twin-flows";
import { NextStagePointer } from "@/components/stage-nav";
import { Pagination } from "@/components/ui/pagination";
import { pageFromParam, pageSizeFromParam } from "@/lib/pagination";
import { getServerCaller } from "@/trpc/server";

export const metadata: Metadata = { title: "Stage 3 · Digital Twin Flow Execution" };
export const dynamic = "force-dynamic";

export default async function DigitalTwinStage3Page(props: {
  searchParams: Promise<{ page?: string | string[]; size?: string | string[] }>;
}) {
  const { page: pageParam, size } = await props.searchParams;
  const pageSize = pageSizeFromParam(size);
  const trpc = await getServerCaller();
  const [list, config] = await Promise.all([
    trpc.digitalTwins.stage3List({ page: pageFromParam(pageParam), pageSize }),
    trpc.digitalTwins.stage3Config(),
  ]);
  const flows = config.flows.map((flow) => ({ key: flow.key, label: flow.label, stepCount: flow.steps.length }));

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">Digital Twins · Stage 3</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Flow Execution</h1>
        <p className="text-sm text-ink-muted">
          Run the same DatasetTesting reasoning flows over each answer-free Stage 2 episode. The final part returns the official 1-based choice codes or numeric response values, ready for benchmark scoring.
        </p>
      </header>

      {list.selection === null ? (
        <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
          Complete <Link href="/digital-twins/stage-2" className="text-accent hover:underline">Stage 2</Link> first.
        </p>
      ) : (
        <>
          <RunDigitalTwinFlows flows={flows} episodeCount={list.total} maxConcurrent={config.maxConcurrent} />
          <p className="text-sm text-ink-muted">{list.completeCells} of {list.totalCells} episode × flow cells complete.</p>
          {list.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">No current Stage 2 episodes are available.</p>
          ) : (
            <ul className="space-y-4">
              {list.rows.map(({ episode, cells }) => (
                <li key={`${episode.profile_id}/${episode.id}`} className="space-y-3 rounded-lg border border-line bg-surface-raised p-4">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-ink">{episode.task_label}</p>
                    <span className="font-mono text-xs text-ink-subtle">Participant {episode.participant_id} · {episode.target_columns.length} answers</span>
                  </div>
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {cells.map((cell) => {
                      const count = cell.answers ? Object.keys(cell.answers).length : 0;
                      return (
                        <div key={cell.flowKey} className="rounded-md border border-line bg-canvas p-3">
                          <div className="flex items-center justify-between gap-2 text-sm">
                            <span className="font-medium text-ink">{cell.flowLabel}</span>
                            <span className={cell.doneSteps === cell.stepCount ? "text-accent" : "text-ink-subtle"}>{cell.doneSteps}/{cell.stepCount}</span>
                          </div>
                          <p className="mt-1 text-xs text-ink-subtle">{cell.stale ? "Stale inputs — rerun required" : count > 0 ? `${count} coded predictions saved` : "Prediction not generated"}</p>
                        </div>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <Pagination page={list.page} total={list.total} pageSize={pageSize} unit="episodes" pageParams={["page"]} hrefFor={(target) => `/digital-twins/stage-3?page=${target}&size=${pageSize}`} />
        </>
      )}

      <NextStagePointer stage="Stage 4" title="Evaluation" description="Compare each flow's predictions with the held-out participant answers." href="/digital-twins/stage-4" />
    </main>
  );
}
