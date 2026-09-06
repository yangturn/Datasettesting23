"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { RunProgress, useRun } from "@/components/run-progress";
import { trpc } from "@/trpc/client";

export function GenerateDigitalTwinEpisodes({
  personaCount,
  taskCount,
  currentCount,
  staleCount,
  maxConcurrent,
}: {
  personaCount: number;
  taskCount: number;
  currentCount: number;
  staleCount: number;
  maxConcurrent: number;
}) {
  const [skipExisting, setSkipExisting] = useState(true);
  const { run, running, adopt, cancel, cancelling } = useRun(
    "digital-twin-episodes",
  );
  const generate = trpc.digitalTwins.generateStage2.useMutation({
    onSuccess: (record) => adopt(record),
  });
  const busy = generate.isPending || running;
  const total = personaCount * taskCount;
  const targets = skipExisting ? total - currentCount : total;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">Episode generator</p>
          <p className="text-sm text-ink-muted">
            Uses Generator&apos;s Stage 2 context process for each answer-free
            official evaluation task.
          </p>
        </div>

        <div className="flex items-center gap-3">
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
            onClick={() => generate.mutate({ skipExisting })}
            disabled={busy || targets === 0}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy
              ? "Generating…"
              : skipExisting
                ? `Generate ${targets} missing`
                : `Regenerate all ${targets}`}
          </button>
        </div>
      </div>

      <p className="text-sm text-ink-subtle">
        {targets === 0
          ? "Every available persona already has all task episodes."
          : `Will generate ${targets} ${targets === 1 ? "episode" : "episodes"} across ${personaCount} ${personaCount === 1 ? "persona" : "personas"} and ${taskCount} task families — one context call each, with up to ${maxConcurrent} in parallel.`}
      </p>

      {staleCount > 0 && (
        <p className="text-sm text-danger">
          {staleCount} existing {staleCount === 1 ? "episode was" : "episodes were"} built from an older Stage 1 persona and will be regenerated.
        </p>
      )}

      {generate.error && (
        <p className="text-sm text-danger">{generate.error.message}</p>
      )}

      <RunProgress
        run={run}
        unit="episode"
        onCancel={cancel}
        cancelling={cancelling}
      />
    </div>
  );
}
