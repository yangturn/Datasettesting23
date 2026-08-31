"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

import { RunProgress, useRun } from "@/components/run-progress";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/client";

export function RunFlows({
  flows,
  scenarioCount,
  maxConcurrent,
}: {
  flows: {
    key: string;
    label: string;
    /** Steps in this flow — model calls per scenario. */
    stepCount: number;
  }[];
  scenarioCount: number;
  maxConcurrent: number;
}) {
  const [skipExisting, setSkipExisting] = useState(true);
  // Every flow by default: the point of the stage is the comparison, and a grid
  // with one column filled is not one. Narrowing is for re-running a single flow
  // after editing its steps.
  const [selected, setSelected] = useState<string[]>(() =>
    flows.map((flow) => flow.key),
  );
  // How many scenarios this run may touch. Starts as "no cap"; a number caps it.
  // Null rather than `scenarioCount`, so a run started after the population grows
  // is not silently held to a ceiling set when the box was first rendered.
  const [limit, setLimit] = useState<number | null>(null);

  const { run, running, adopt, cancel, cancelling } = useRun("executions");

  /**
   * What a run would cost, per pending scenario, in the order a limit takes
   * them. Keyed on the flow selection and skip-existing only — the limit is
   * applied here by summing a prefix, so typing in the box costs no round trip.
   */
  const plan = trpc.executions.plan.useQuery({
    flowKeys: selected,
    skipExisting,
  });

  // The mutation returns as soon as the run exists; the run itself outlives
  // this request, so progress comes from polling rather than from awaiting it.
  const generate = trpc.executions.generate.useMutation({
    onSuccess: (record) => adopt(record),
  });

  // The plan is a snapshot of what was left to do, and a finished run has just
  // invalidated it. `useRun` refreshes the server-rendered listings on the same
  // transition; this is the client-side half of that.
  const settled = run !== null && run.status !== "running";
  const refetchPlan = plan.refetch;
  useEffect(() => {
    if (settled) void refetchPlan();
  }, [settled, refetchPlan]);

  const busy = generate.isPending || running;

  const pendingSteps = plan.data?.pendingSteps ?? [];
  const pendingScenarios = pendingSteps.length;
  // A limit above what is pending is not a cap at all, so the counts below
  // report what will happen rather than what was asked for.
  const scenariosToRun =
    limit === null ? pendingScenarios : Math.min(limit, pendingScenarios);
  // Counted in model calls, since that is what a run costs. A scenario is not
  // one call: it is one per part, per selected flow.
  const targets = pendingSteps
    .slice(0, scenariosToRun)
    .reduce((total, steps) => total + steps, 0);
  const heldBack = pendingScenarios - scenariosToRun;

  const parallelism =
    scenariosToRun <= maxConcurrent
      ? "all in parallel"
      : `${maxConcurrent} in parallel at a time`;

  const toggle = (key: string) =>
    setSelected((current) =>
      current.includes(key)
        ? current.filter((entry) => entry !== key)
        : // Kept in registry order rather than click order, so the request reads
          // the same way the page does.
          flows
            .map((flow) => flow.key)
            .filter((entry) => entry === key || current.includes(entry)),
    );

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      {/* The text column absorbs its own wrapping (min-w-0 flex-1) so a longer
          message never pushes the controls onto a second row. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-ink">Flow runner</p>
          <p className="text-sm text-ink-muted">
            Runs the selected {selected.length === 1 ? "flow" : "flows"} over
            Stage 2&apos;s scenarios, part by part. {scenarioCount}{" "}
            {scenarioCount === 1 ? "scenario is" : "scenarios are"} available.
            {!skipExisting && (
              <span className="text-danger">
                {" "}
                Discards whatever those cells already hold and starts over.
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
              generate.mutate({
                flowKeys: selected,
                skipExisting,
                limit: limit ?? undefined,
              })
            }
            disabled={busy || targets === 0 || selected.length === 0}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy
              ? "Running…"
              : skipExisting
                ? `Run ${targets} remaining`
                : `Rerun ${targets}`}
          </button>
        </div>
      </div>

      {/* Its own row rather than crammed in beside the button: how much of the
          population a run touches is a decision about the experiment, not a
          modifier on the button, and it is the first thing you reach for on a
          test run. */}
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
            // Empty is "no cap" rather than a number, because no fixed number
            // keeps meaning "all" once the population grows. The All button
            // above is what makes that state visible instead of a blank box.
            value={limit ?? ""}
            placeholder="first…"
            aria-label="How many scenarios to run"
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

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-sm text-ink-subtle">Flows</span>
        {flows.map((flow) => (
          <label
            key={flow.key}
            className="flex items-center gap-2 text-sm text-ink-muted"
          >
            <input
              type="checkbox"
              checked={selected.includes(flow.key)}
              onChange={() => toggle(flow.key)}
              disabled={busy}
              className="size-4 accent-accent disabled:opacity-50"
            />
            {flow.label}
            <span className="text-ink-subtle">
              ({flow.stepCount} {flow.stepCount === 1 ? "part" : "parts"})
            </span>
          </label>
        ))}
      </div>

      <p className="text-sm text-ink-subtle">
        {selected.length === 0 ? (
          <>Pick at least one flow to run.</>
        ) : plan.isPending ? (
          <>Working out what is left to run…</>
        ) : plan.error ? (
          <span className="text-danger">{plan.error.message}</span>
        ) : scenarioCount === 0 ? (
          <>No runnable scenarios yet.</>
        ) : targets === 0 ? (
          <>
            Every part of every selected flow has already run. Untick “skip
            existing” to run them again.
          </>
        ) : (
          <>
            {busy ? "Running" : "Will run"} {targets} model{" "}
            {targets === 1 ? "call" : "calls"} over {scenariosToRun}{" "}
            {scenariosToRun === 1 ? "scenario" : "scenarios"} — one call per
            part, per scenario. Runs {parallelism}, with a flow&apos;s own parts
            in sequence so each can read what the parts before it produced.
            {heldBack > 0 && (
              <>
                {" "}
                {heldBack} more {heldBack === 1 ? "scenario" : "scenarios"} with
                work left over; raise the limit to reach{" "}
                {heldBack === 1 ? "it" : "them"}.
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
        unit="part"
        onCancel={cancel}
        cancelling={cancelling}
      />
    </div>
  );
}
