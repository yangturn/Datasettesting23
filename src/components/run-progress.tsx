"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Loader2, X } from "lucide-react";

import { isFinished, runProgress, type RunRecord, type RunStage } from "@/lib/run";
import { trpc } from "@/trpc/client";

/** How often a live run is polled. Runs take minutes; a second is plenty. */
const POLL_MS = 1000;

/**
 * Floor on how often the page's server-rendered listings are re-fetched while a
 * run is going. Progress comes from polling the run record, which is cheap; this
 * is only so new rows appear without waiting for the run to end.
 */
const LISTING_REFRESH_MS = 3000;

/**
 * Follows a stage's run, whoever started it.
 *
 * The run lives on the server, not in this component, so a refresh re-attaches
 * to whatever is in flight instead of losing it: `latest` supplies the run id on
 * mount, and polling picks up from there. `adopt` is for the component that just
 * started one — it skips a poll cycle by taking the record the mutation
 * returned.
 */
export function useRun(stage: RunStage) {
  const router = useRouter();
  const [adopted, setAdopted] = useState<RunRecord | null>(null);

  // Only consulted until a run is adopted — after that the id is known and this
  // query would just be a second source of truth for the same record.
  const latest = trpc.runs.latest.useQuery(
    { stage },
    { enabled: adopted === null },
  );

  const id = adopted?.id ?? latest.data?.id ?? null;
  const seed = adopted ?? latest.data ?? null;

  const polled = trpc.runs.get.useQuery(
    { id: id ?? "" },
    {
      enabled: id !== null,
      // Re-read on every render, so it stops the moment the run reports a
      // terminal status rather than one interval later.
      refetchInterval: (query) =>
        query.state.data && query.state.data.status === "running"
          ? POLL_MS
          : false,
    },
  );

  // The freshest of the two: a poll result once there is one, else the seed.
  const run = polled.data ?? seed;
  const running = run !== null && run.status === "running";

  const cancel = trpc.runs.cancel.useMutation({
    onSuccess: () => void polled.refetch(),
  });

  // The listings on the page are server-rendered, so they only pick up what a
  // run wrote once the route re-renders. Refreshed on completion, and while
  // running so rows appear as they land.
  const lastStatus = useRef<string | null>(null);
  useEffect(() => {
    if (!run) return;
    const changed = lastStatus.current !== run.status;
    lastStatus.current = run.status;
    if (changed && isFinished(run)) router.refresh();
  }, [run, router]);

  // Throttled rather than per item: a refresh re-renders the whole route, and a
  // few-hundred-item run would otherwise fire one for every record it wrote.
  const doneCount = run ? run.done + run.failed : 0;
  const lastRefresh = useRef(0);
  useEffect(() => {
    if (!running || doneCount === 0) return;
    const now = Date.now();
    if (now - lastRefresh.current < LISTING_REFRESH_MS) return;
    lastRefresh.current = now;
    router.refresh();
  }, [running, doneCount, router]);

  return {
    run,
    running,
    adopt: setAdopted,
    cancel: () => {
      if (run) cancel.mutate({ id: run.id });
    },
    cancelling: cancel.isPending,
  };
}

const STATUS_COPY: Record<RunRecord["status"], string> = {
  running: "Running",
  succeeded: "Finished",
  failed: "Stopped",
  cancelled: "Cancelled",
};

/**
 * The state of one run: progress while it goes, counts and errors once it ends.
 * Renders nothing when a stage has never been run.
 */
export function RunProgress({
  run,
  unit,
  onCancel,
  cancelling,
}: {
  run: RunRecord | null;
  /** Singular noun for the thing being generated, e.g. "description". */
  unit: string;
  onCancel: () => void;
  cancelling: boolean;
}) {
  if (!run) return null;

  const running = run.status === "running";
  const processed = run.done + run.failed;
  const fraction = runProgress(run);
  const plural = (count: number) => (count === 1 ? unit : `${unit}s`);

  return (
    <div className="space-y-3 rounded-lg border border-line bg-canvas p-4">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2">
        <p className="flex items-center gap-2 text-sm text-ink">
          {running && (
            <Loader2 className="size-4 animate-spin text-accent" aria-hidden />
          )}
          <span className="font-medium">{STATUS_COPY[run.status]}</span>
          <span className="text-ink-muted">
            {run.total === null
              ? `${processed} ${plural(processed)} so far`
              : `${processed} of ${run.total} ${plural(run.total)}`}
            {run.failed > 0 && `, ${run.failed} failed`}
          </span>
        </p>

        {running && (
          <button
            type="button"
            onClick={onCancel}
            disabled={cancelling}
            className="inline-flex items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-1 text-sm text-ink-muted hover:text-ink disabled:opacity-50"
          >
            <X className="size-3.5" aria-hidden />
            {cancelling ? "Cancelling…" : "Cancel"}
          </button>
        )}
      </div>

      {fraction !== null && (
        <div
          className="h-1.5 overflow-hidden rounded-full bg-surface-raised"
          role="progressbar"
          aria-valuenow={Math.round(fraction * 100)}
          aria-valuemin={0}
          aria-valuemax={100}
        >
          <div
            className={`h-full rounded-full transition-[width] duration-500 ${
              run.failed > 0 ? "bg-danger" : "bg-accent"
            }`}
            style={{ width: `${Math.round(fraction * 100)}%` }}
          />
        </div>
      )}

      <p className="text-sm text-ink-subtle">
        {running ? (
          <>
            Running on the server — safe to refresh or close this page.{" "}
            <span className="font-mono text-ink-muted">{run.model}</span>
          </>
        ) : (
          <>
            {run.message ?? `Ran with `}
            {run.message === null && (
              <span className="font-mono text-ink-muted">{run.model}</span>
            )}
          </>
        )}
      </p>

      {run.errors.length > 0 && (
        <ul className="space-y-1 text-sm">
          {run.errors.map((entry, index) => (
            <li key={`${entry.id}-${index}`} className="text-ink-muted">
              <span className="font-mono text-danger">{entry.id}</span>:{" "}
              {entry.error}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
