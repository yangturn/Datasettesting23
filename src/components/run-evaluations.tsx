"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { RunProgress, useRun } from "@/components/run-progress";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/client";

export function RunEvaluations({
  scenarioCount,
}: {
  scenarioCount: number;
}) {
  const [skipExisting, setSkipExisting] = useState(true);
  // How many scenarios this run may touch. Null is "no cap"; a number caps it.
  const [limit, setLimit] = useState<number | null>(null);

  const { run, running, adopt, cancel, cancelling } = useRun("evaluations");

  const plan = trpc.evaluations.plan.useQuery({ skipExisting });

  // The mutation returns as soon as the run exists; the run itself outlives
  // this request, so progress comes from polling rather than from awaiting it.
  const generate = trpc.evaluations.generate.useMutation({
    onSuccess: (record) => adopt(record),
  });

  // The plan is a snapshot of what was left to do, and a finished run has just
  // invalidated it.
  const settled = run !== null && run.status !== "running";
  const refetchPlan = plan.refetch;
  useEffect(() => {
    if (settled) void refetchPlan();
  }, [settled, refetchPlan]);

  const busy = generate.isPending || running;

  const pending = plan.data?.pending ?? [];
  const scenariosToRun =
    limit === null ? pending.length : Math.min(limit, pending.length);
  const taken = pending.slice(0, scenariosToRun);
  const calls = taken.reduce((total, item) => total + item.calls, 0);
  const contexts = taken.filter((item) => item.needsContext).length;
  const scores = taken.reduce((total, item) => total + item.scores, 0);
  const heldBack = pending.length - scenariosToRun;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-ink">Evaluation runner</p>
          <p className="text-sm text-ink-muted">
            Per scenario: build the independent context, then score each
            flow&apos;s predicted action against it. {scenarioCount}{" "}
            {scenarioCount === 1 ? "scenario is" : "scenarios are"} available.
            {!skipExisting && (
              <span className="text-danger">
                {" "}
                Rebuilds contexts and re-scores predictions that already exist.
              </span>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={skipExisting}
              onChange={(event) => setSkipExisting(event.target.checked)}
              disabled={busy}
              className="size-4 accent-accent disabled:opacity-50"
            />
            skip existing
          </label>

          <button
            type="button"
            onClick={() =>
              generate.mutate({ skipExisting, limit: limit ?? undefined })
            }
            disabled={busy || calls === 0}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy ? "Evaluating…" : `Run ${calls}`}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-sm text-ink-subtle">Scenarios</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setLimit(null)}
            disabled={busy}
            className={cn(
              "rounded-md border px-2.5 py-1 text-sm disabled:opacity-50",
              limit === null
                ? "border-accent bg-surface-raised text-accent"
                : "border-line-strong text-ink-muted hover:text-ink",
            )}
          >
            All {scenarioCount}
          </button>
          <span className="text-sm text-ink-subtle">or</span>
          <input
            type="number"
            min={1}
            max={scenarioCount}
            value={limit ?? ""}
            placeholder="first…"
            aria-label="How many scenarios to evaluate"
            onChange={(event) => {
              const raw = event.target.value.trim();
              if (raw === "") return setLimit(null);
              const parsed = Math.trunc(Number(raw));
              setLimit(
                Number.isFinite(parsed) && parsed >= 1
                  ? Math.min(parsed, scenarioCount)
                  : 1,
              );
            }}
            disabled={busy}
            className="w-20 rounded-md border border-line-strong bg-canvas px-2 py-1 text-sm text-ink disabled:opacity-50"
          />
        </div>
        <span className="text-sm text-ink-subtle">
          {limit === null
            ? "every scenario with work left"
            : `the first ${scenariosToRun}, spread across as many different people as that reaches`}
        </span>
      </div>

      <p className="text-sm text-ink-subtle">
        {plan.isPending ? (
          <>Working out what is left to do…</>
        ) : plan.error ? (
          <span className="text-danger">{plan.error.message}</span>
        ) : scenarioCount === 0 ? (
          <>No runnable scenarios yet.</>
        ) : calls === 0 ? (
          <>
            Everything scorable has been scored. Untick “skip existing” to run it
            again.
          </>
        ) : (
          <>
            {busy ? "Running" : "Will run"} {calls} model{" "}
            {calls === 1 ? "call" : "calls"} over {scenariosToRun}{" "}
            {scenariosToRun === 1 ? "scenario" : "scenarios"} — {contexts}{" "}
            {contexts === 1 ? "context" : "contexts"} and {scores}{" "}
            {scores === 1 ? "score" : "scores"}. Strictly one call at a time, in
            order, so a stopped run is a clean prefix rather than a scattering.
            {heldBack > 0 && (
              <>
                {" "}
                {heldBack} more {heldBack === 1 ? "scenario" : "scenarios"} left
                over; raise the limit to reach {heldBack === 1 ? "it" : "them"}.
              </>
            )}
          </>
        )}
      </p>

      {generate.error && (
        <p className="text-sm text-danger">{generate.error.message}</p>
      )}

      <RunProgress
        run={run}
        unit="call"
        onCancel={cancel}
        cancelling={cancelling}
      />
    </div>
  );
}
