import type { Metadata } from "next";

import { ProcessDigitalTwinProfiles } from "@/components/process-digital-twin-profiles";
import { Pagination } from "@/components/ui/pagination";
import { NextStagePointer } from "@/components/stage-nav";
import { pageFromParam, pageSizeFromParam } from "@/lib/pagination";
import { getServerCaller } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Stage 0 · Digital Twin Profile Generation",
};

export const dynamic = "force-dynamic";

export default async function DigitalTwinStage0Page(
  props: PageProps<"/digital-twins/stage-0">,
) {
  const { page: pageParam, size } = await props.searchParams;
  const pageSize = pageSizeFromParam(size);
  const trpc = await getServerCaller();
  const [config, selection] = await Promise.all([
    trpc.digitalTwins.config(),
    trpc.digitalTwins.currentSelection({
      page: pageFromParam(pageParam),
      pageSize,
    }),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
          Digital Twins · Stage 0
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Profile Generation
        </h1>
        <p className="text-sm text-ink-muted">
          Select real participants from the Twin-2K-500 dataset. Their non-held-out
          Waves 1–3 answers become the evidence used to construct DatasetTesting personas.
        </p>
      </header>

      <ProcessDigitalTwinProfiles totalAvailable={config.totalAvailable} />

      {selection === null ? (
        <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
          No Digital Twin personas have been processed yet.
        </p>
      ) : (
        <section className="space-y-4">
          <div className="space-y-1 text-sm">
            <p className="font-medium text-ink">
              Current selection · {selection.selected_count.toLocaleString()} personas
            </p>
            <p className="text-ink-muted">
              Seed <span className="font-mono text-xs text-ink">{selection.seed}</span>
            </p>
          </div>

          <ul className="space-y-3">
            {selection.rows.map((profile) => (
              <li
                key={profile.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-line bg-surface-raised p-4"
              >
                <div className="space-y-1">
                  <p className="text-sm font-medium text-ink">
                    Participant {profile.participant_id}
                  </p>
                  <p className="font-mono text-xs text-ink-subtle">{profile.id}</p>
                </div>
                <div className="text-right text-xs text-ink-muted">
                  <p>{profile.persona_text_characters.toLocaleString()} text characters</p>
                  <p>{profile.source_file}</p>
                </div>
              </li>
            ))}
          </ul>

          <Pagination
            page={selection.page}
            total={selection.total}
            pageSize={pageSize}
            unit="personas"
            pageParams={["page"]}
            hrefFor={(target) =>
              `/digital-twins/stage-0?page=${target}&size=${pageSize}`
            }
          />
        </section>
      )}

      <NextStagePointer
        stage="Stage 1"
        title="Person / Population Creation"
        description="Transform each participant's survey evidence into a DatasetTesting persona."
        href="/digital-twins/stage-1"
      />
    </main>
  );
}
