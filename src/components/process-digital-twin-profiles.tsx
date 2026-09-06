"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { RunProgress, useRun } from "@/components/run-progress";
import { trpc } from "@/trpc/client";

export function ProcessDigitalTwinProfiles({
  totalAvailable,
}: {
  totalAvailable: number;
}) {
  const [count, setCount] = useState(() => Math.min(10, totalAvailable));
  const { run, running, adopt, cancel, cancelling } = useRun(
    "digital-twin-profiles",
  );
  const processProfiles = trpc.digitalTwins.processProfiles.useMutation({
    onSuccess: (record) => adopt(record),
  });
  const busy = processProfiles.isPending || running;

  const clamp = (value: number) =>
    Math.min(totalAvailable, Math.max(1, Math.trunc(value) || 1));

  return (
    <div className="space-y-4 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-ink">Participant selection</p>
          <p className="text-sm text-ink-muted">
            Participants will be chosen at random from all {totalAvailable.toLocaleString()} available personas.
            A random seed is saved with every selection so it can be reproduced.
          </p>
        </div>

        <div className="flex shrink-0 items-end gap-3">
          <label className="space-y-1 text-sm text-ink-muted">
            <span className="block">How many personas</span>
            <input
              type="number"
              min={1}
              max={totalAvailable}
              value={count}
              onChange={(event) => setCount(clamp(Number(event.target.value)))}
              disabled={busy}
              className="w-28 rounded-md border border-line-strong bg-canvas px-3 py-1.5 text-ink disabled:opacity-50"
            />
          </label>

          <button
            type="button"
            onClick={() => processProfiles.mutate({ count })}
            disabled={busy || totalAvailable === 0}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy ? "Processing…" : "Start processing"}
          </button>
        </div>
      </div>

      <p className="text-sm text-ink-subtle">
        This will create a new selection of {count.toLocaleString()} {count === 1 ? "persona" : "personas"}.
        Previous selections remain stored for reproducibility.
      </p>

      {processProfiles.error && (
        <p className="text-sm text-danger">{processProfiles.error.message}</p>
      )}

      <RunProgress
        run={run}
        unit="persona"
        onCancel={cancel}
        cancelling={cancelling}
      />
    </div>
  );
}

