"use client";

import { Loader2 } from "lucide-react";
import { useState } from "react";

import { RunProgress, useRun } from "@/components/run-progress";
import { trpc } from "@/trpc/client";

export function GenerateDigitalTwinPersonas({
  profileCount,
  generatedCount,
  targetNarrativeWords,
  maxConcurrent,
}: {
  profileCount: number;
  generatedCount: number;
  targetNarrativeWords: number;
  maxConcurrent: number;
}) {
  const [skipExisting, setSkipExisting] = useState(true);
  const { run, running, adopt, cancel, cancelling } = useRun(
    "digital-twin-personas",
  );
  const generate = trpc.digitalTwins.generateStage1.useMutation({
    onSuccess: (record) => adopt(record),
  });
  const busy = generate.isPending || running;
  const targets = skipExisting ? profileCount - generatedCount : profileCount;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">Persona generator</p>
          <p className="text-sm text-ink-muted">
            Builds an evidence-grounded narrative and structured traits while
            retaining the original survey transcript for later retrieval.
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
          ? "Every selected participant already has a Stage 1 persona."
          : `Will generate ${targets} ${targets === 1 ? "persona" : "personas"} of roughly ${targetNarrativeWords} narrative words, with up to ${maxConcurrent} model calls in parallel.`}
      </p>

      {generatedCount > 0 && !skipExisting && (
        <p className="text-sm text-danger">
          This will overwrite {generatedCount} existing Stage 1 {generatedCount === 1 ? "persona" : "personas"} for the current selection.
        </p>
      )}

      {generate.error && (
        <p className="text-sm text-danger">{generate.error.message}</p>
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

