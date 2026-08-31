import type { Metadata } from "next";

import { GenerateProfiles } from "@/components/generate-profiles";
import { NextStagePointer } from "@/components/stage-nav";
import { Tag } from "@/components/ui/section";
import { Pagination } from "@/components/ui/pagination";
import { pageFromParam, pageSizeFromParam } from "@/lib/pagination";
import { getServerCaller } from "@/trpc/server";

export const metadata: Metadata = {
  title: "Stage 0 · Profile Generation",
};

// Profiles are written to disk by the generator, so this page must not be
// cached between runs.
export const dynamic = "force-dynamic";

export default async function Stage0Page(props: PageProps<"/stage-0">) {
  // The URL says which page to ask for; the router does the slicing and
  // reports back the totals, so this page never holds the whole population.
  const { page: pageParam, size } = await props.searchParams;
  const pageSize = pageSizeFromParam(size);

  const trpc = await getServerCaller();
  const [profiles, config] = await Promise.all([
    trpc.profiles.list({ page: pageFromParam(pageParam), pageSize }),
    trpc.profiles.config(),
  ]);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="space-y-2">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
          Stage 0
        </p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">
          Profile Generation
        </h1>
        <p className="text-sm text-ink-muted">
          Short sketches of who each person is — the seeds the population grows
          from. Every profile is generated against a distinct combination of
          demographic and dispositional axes, so the population is diverse by
          construction rather than by chance. Stage 1 elaborates each sketch
          into a full canonical person.
        </p>
      </header>

      <GenerateProfiles
        existingCount={profiles.total}
        maxPerRun={config.maxPerRun}
        perRequest={config.perRequest}
        maxConcurrent={config.maxConcurrent}
      />

      {profiles.total === 0 ? (
        <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
          No profiles yet. Run the generator above.
        </p>
      ) : (
        <>
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 text-sm text-ink-subtle">
            <span className="text-ink-muted">
              {profiles.total} {profiles.total === 1 ? "profile" : "profiles"}
            </span>
            {profiles.coverage.map(({ label, value }) => (
              <span key={label}>
                {value} {label}
              </span>
            ))}
          </div>

          <ul className="space-y-3">
            {profiles.rows.map((profile) => (
              <li
                key={profile.id}
                className="space-y-3 rounded-lg border border-line bg-surface-raised p-4"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
                  <span className="text-sm font-medium text-ink">
                    {profile.name}
                  </span>
                  <span className="font-mono text-xs text-ink-subtle">
                    {profile.id}
                  </span>
                </div>
                <p className="text-sm text-ink-muted">{profile.headline}</p>
                <p className="text-sm leading-relaxed text-ink">
                  {profile.description}
                </p>
                <div className="flex flex-wrap gap-2">
                  <Tag>{profile.seed.region}</Tag>
                  <Tag>{profile.seed.age_band}</Tag>
                  <Tag>{profile.seed.domain}</Tag>
                  <Tag>{profile.seed.temperament}</Tag>
                </div>
              </li>
            ))}
          </ul>

          <Pagination
            page={profiles.page}
            total={profiles.total}
            pageSize={pageSize}
            unit="profiles"
            pageParams={["page"]}
            hrefFor={(target) =>
              `/stage-0?page=${target}&size=${pageSize}`
            }
          />
        </>
      )}

      <NextStagePointer
        stage="Stage 1"
        title="Person / Population Creation"
        description="Elaborate each profile into a canonical long description."
        href="/stage-1"
      />
    </main>
  );
}
