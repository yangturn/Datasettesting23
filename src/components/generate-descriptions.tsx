"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { RunProgress, useRun } from "@/components/run-progress";
import { trpc } from "@/trpc/client";

export function GenerateDescriptions({
  profileCount,
  describedCount,
  targetWordCount,
  maxConcurrent,
}: {
  profileCount: number;
  describedCount: number;
  targetWordCount: number;
  maxConcurrent: number;
}) {
  const [skipExisting, setSkipExisting] = useState(true);
  const { run, running, adopt, cancel, cancelling } = useRun("descriptions");

  // The mutation returns as soon as the run exists; the run itself outlives
  // this request, so progress comes from polling rather than from awaiting it.
  const generate = trpc.descriptions.generate.useMutation({
    onSuccess: (record) => adopt(record),
  });

  const busy = generate.isPending || running;

  const pending = profileCount - describedCount;
  const targets = skipExisting ? pending : profileCount;
  const parallelism =
    targets <= maxConcurrent
      ? "all in parallel"
      : `${maxConcurrent} in parallel at a time`;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="space-y-1">
          <p className="text-sm font-medium text-ink">Description generator</p>
          <p className="text-sm text-ink-muted">
            Runs across all {profileCount}{" "}
            {profileCount === 1 ? "profile" : "profiles"} from Stage 0.
            {describedCount > 0 && !skipExisting && (
              <span className="text-danger">
                {" "}
                Overwrites the {describedCount} existing{" "}
                {describedCount === 1 ? "description" : "descriptions"}.
              </span>
            )}
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
        {targets === 0 ? (
          <>
            Every profile already has a description. Untick “skip existing” to
            regenerate them.
          </>
        ) : (
          <>
            {busy ? "Generating" : "Will generate"} {targets}{" "}
            {targets === 1 ? "description" : "descriptions"} of roughly{" "}
            {targetWordCount} words — one model call each, {parallelism}.
          </>
        )}
      </p>

      {generate.error && (
        <p className="text-sm text-danger">{generate.error.message}</p>
      )}

      <RunProgress
        run={run}
        unit="description"
        onCancel={cancel}
        cancelling={cancelling}
      />
    </div>
  );
}
