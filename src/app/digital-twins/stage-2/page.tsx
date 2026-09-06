import Link from "next/link";
import type { Metadata } from "next";

import { GenerateDigitalTwinEpisodes } from "@/components/generate-digital-twin-episodes";
import { NextStagePointer } from "@/components/stage-nav";
import { Pagination } from "@/components/ui/pagination";
import { pageFromParam, pageSizeFromParam } from "@/lib/pagination";
import { getServerCaller } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Stage 2 · Digital Twin Episodes",
};

export const dynamic = "force-dynamic";

export default async function DigitalTwinStage2Page(
  props: PageProps<"/digital-twins/stage-2">,
) {
  const { page: pageParam, size } = await props.searchParams;
  const pageSize = pageSizeFromParam(size);
  const trpc = await getServerCaller();
  const [list, config] = await Promise.all([
    trpc.digitalTwins.stage2List({
      page: pageFromParam(pageParam),
      pageSize,
    }),
    trpc.digitalTwins.stage2Config(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
          Digital Twins · Stage 2
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Episode Creation
        </h1>
        <p className="text-sm text-ink-muted">
          Turn the 85 held-out questions into 17 task-level episodes. Each episode
          uses the same context-generation prompt and fields as Generator Stage 2,
          but never receives the participant&apos;s reference or retest answers.
        </p>
      </header>

      {list.selection === null ? (
        <div className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
          Complete{" "}
          <Link href="/digital-twins/stage-0" className="text-accent hover:underline">
            Stage 0
          </Link>{" "}
          and{" "}
          <Link href="/digital-twins/stage-1" className="text-accent hover:underline">
            Stage 1
          </Link>{" "}
          before creating episodes.
        </div>
      ) : (
        <>
          <GenerateDigitalTwinEpisodes
            personaCount={list.personaCount}
            taskCount={config.taskCount}
            currentCount={list.currentCount}
            staleCount={list.staleCount}
            maxConcurrent={config.maxConcurrent}
          />

          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-ink-muted">
            <span>{list.currentCount} of {list.personaCount * config.taskCount} current episodes</span>
            <span>{list.targetQuestionCount} held-out question objects</span>
            <span>{list.targetColumnCount} scored response fields</span>
          </div>

          {list.rows.length === 0 ? (
            <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
              No episodes generated yet.
            </p>
          ) : (
            <ul className="space-y-3">
              {list.rows.map((row) => (
                <li
                  key={`${row.profile_id}/${row.id}`}
                  className="space-y-2 rounded-lg border border-line bg-surface-raised p-4"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-3">
                    <p className="text-sm font-medium text-ink">{row.task_label}</p>
                    <span className="font-mono text-xs text-ink-subtle">
                      Participant {row.participant_id}
                    </span>
                  </div>
                  <p className="text-sm text-ink-muted">
                    {row.questions.length} {row.questions.length === 1 ? "question" : "questions"} ·{" "}
                    {row.target_columns.length} scored {row.target_columns.length === 1 ? "field" : "fields"}
                  </p>
                  <p className="text-xs text-ink-subtle">
                    {row.contextItemCount} generated context items
                    {row.stale ? " · stale after Stage 1 regeneration" : ""}
                  </p>
                </li>
              ))}
            </ul>
          )}

          <Pagination
            page={list.page}
            total={list.total}
            pageSize={pageSize}
            unit="episodes"
            pageParams={["page"]}
            hrefFor={(target) =>
              `/digital-twins/stage-2?page=${target}&size=${pageSize}`
            }
          />
        </>
      )}

      <NextStagePointer
        stage="Stage 3"
        title="Flow Execution"
        description="Run DatasetTesting's candidate reasoning flows against each episode."
      />
    </main>
  );
}
