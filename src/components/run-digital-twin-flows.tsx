"use client";

import { Loader2 } from "lucide-react";
import { useEffect, useState } from "react";

import { RunProgress, useRun } from "@/components/run-progress";
import { cn } from "@/lib/utils";
import { trpc } from "@/trpc/client";

export function RunDigitalTwinFlows({ flows, episodeCount, maxConcurrent }: {
  flows: { key: string; label: string; stepCount: number }[];
  episodeCount: number;
  maxConcurrent: number;
}) {
  const [selected, setSelected] = useState(() => flows.map((flow) => flow.key));
  const [skipExisting, setSkipExisting] = useState(true);
  const [limit, setLimit] = useState<number | null>(null);
  const { run, running, adopt, cancel, cancelling } = useRun("digital-twin-executions");
  const plan = trpc.digitalTwins.stage3Plan.useQuery({ flowKeys: selected, skipExisting });
  const generate = trpc.digitalTwins.generateStage3.useMutation({ onSuccess: adopt });
  const settled = run !== null && run.status !== "running";
  const refetch = plan.refetch;
  useEffect(() => { if (settled) void refetch(); }, [settled, refetch]);

  const pending = plan.data?.pendingCalls ?? [];
  const count = limit === null ? pending.length : Math.min(limit, pending.length);
  const calls = pending.slice(0, count).reduce((sum, value) => sum + value, 0);
  const busy = running || generate.isPending;
  const toggle = (key: string) => setSelected((current) =>
    current.includes(key) ? current.filter((item) => item !== key) : flows.map((flow) => flow.key).filter((item) => item === key || current.includes(item)),
  );

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">Flow runner</p>
          <p className="text-sm text-ink-muted">
            Runs DatasetTesting&apos;s reasoning parts, then predicts exact coded survey answers in the final part.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={skipExisting} onChange={(event) => setSkipExisting(event.target.checked)} disabled={busy} className="size-4 accent-accent" />
            skip existing
          </label>
          <button type="button" onClick={() => generate.mutate({ flowKeys: selected, skipExisting, limit: limit ?? undefined })} disabled={busy || calls === 0 || selected.length === 0} className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50">
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy ? "Running…" : `Run ${calls} ${calls === 1 ? "call" : "calls"}`}
          </button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-ink-subtle">Episodes</span>
        <button type="button" onClick={() => setLimit(null)} disabled={busy} className={cn("rounded-md border px-2.5 py-1", limit === null ? "border-accent text-accent" : "border-line-strong text-ink-muted")}>All {episodeCount}</button>
        <span className="text-ink-subtle">or first</span>
        <input type="number" min={1} max={episodeCount} value={limit ?? ""} placeholder="…" aria-label="Number of episodes to run" onChange={(event) => { const value = event.target.value; setLimit(value === "" ? null : Math.max(1, Math.min(episodeCount, Math.trunc(Number(value)) || 1))); }} disabled={busy} className="w-20 rounded-md border border-line-strong bg-canvas px-2 py-1 text-ink" />
        <span className="text-ink-subtle">up to {maxConcurrent} flow cells in parallel</span>
      </div>

      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {flows.map((flow) => (
          <label key={flow.key} className="flex items-center gap-2 text-sm text-ink-muted">
            <input type="checkbox" checked={selected.includes(flow.key)} onChange={() => toggle(flow.key)} disabled={busy} className="size-4 accent-accent" />
            {flow.label} <span className="text-ink-subtle">({flow.stepCount} parts)</span>
          </label>
        ))}
      </div>

      <p className="text-sm text-ink-subtle">
        {selected.length === 0 ? "Choose at least one flow." : plan.isPending ? "Calculating remaining calls…" : plan.error ? <span className="text-danger">{plan.error.message}</span> : calls === 0 ? "All selected flow cells are complete." : `${count} ${count === 1 ? "episode" : "episodes"} with work remaining; ${calls} model ${calls === 1 ? "call" : "calls"}.`}
      </p>
      {generate.error && <p className="text-sm text-danger">{generate.error.message}</p>}
      <RunProgress run={run} unit="part" onCancel={cancel} cancelling={cancelling} />
    </div>
  );
}
