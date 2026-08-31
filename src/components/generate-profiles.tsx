"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { RunProgress, useRun } from "@/components/run-progress";
import { trpc } from "@/trpc/client";

/**
 * What a run will actually do, stated before it starts: how many model calls of
 * what size, and how many of them run at once.
 */
function describePlan({
  count,
  perRequest,
  maxConcurrent,
}: {
  count: number;
  perRequest: number;
  maxConcurrent: number;
}): string {
  const batches = Math.ceil(count / perRequest);
  const remainder = count % perRequest;

  if (batches === 1) {
    return count === 1
      ? "a single model call."
      : `a single model call for all ${count}.`;
  }

  const calls =
    remainder === 0
      ? `${batches} model calls of ${perRequest}`
      : `${batches} model calls of ${perRequest} (last one ${remainder})`;

  const parallelism =
    batches <= maxConcurrent
      ? "all in parallel"
      : `${maxConcurrent} in parallel at a time`;

  return `${calls}, ${parallelism}.`;
}

export function GenerateProfiles({
  existingCount,
  maxPerRun,
  perRequest,
  maxConcurrent,
}: {
  existingCount: number;
  maxPerRun: number;
  perRequest: number;
  maxConcurrent: number;
}) {
  const [replace, setReplace] = useState(true);
  const [count, setCount] = useState(() => Math.min(10, maxPerRun));
  const { run, running, adopt, cancel, cancelling } = useRun("profiles");

  // The mutation returns as soon as the run exists; the run itself outlives
  // this request, so progress comes from polling rather than from awaiting it.
  const generate = trpc.profiles.generate.useMutation({
    onSuccess: (record) => adopt(record),
  });

  const busy = generate.isPending || running;

  // The ceiling bounds one run, not the population — adding repeatedly can grow
  // the population past it.
  const clamp = (value: number) =>
    Math.min(maxPerRun, Math.max(1, Math.trunc(value) || 1));

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      {/* The text column absorbs its own wrapping (min-w-0 flex-1) so a longer
          message never pushes the controls onto a second row. */}
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-ink">Profile generator</p>
          <p className="text-sm text-ink-muted">
            {replace && existingCount > 0 ? (
              <span className="text-danger">
                Deletes the {existingCount} existing{" "}
                {existingCount === 1 ? "profile" : "profiles"} first, along with
                every description and scenario derived from them.
              </span>
            ) : !replace && existingCount > 0 ? (
              <>Adds to the {existingCount} on unused diversity slots.</>
            ) : (
              <>Up to {maxPerRun} per run, generated in parallel.</>
            )}
          </p>
        </div>

        <div className="flex shrink-0 items-center gap-3">
          <label className="flex items-center gap-2 text-sm text-ink-muted">
            <input
              type="checkbox"
              checked={replace}
              onChange={(event) => setReplace(event.target.checked)}
              disabled={busy}
              className="size-4 accent-accent disabled:opacity-50"
            />
            replace
          </label>

          <label className="flex items-center gap-2 text-sm text-ink-muted">
            how many
            <input
              type="number"
              min={1}
              max={maxPerRun}
              value={count}
              onChange={(event) => setCount(clamp(Number(event.target.value)))}
              disabled={busy}
              className="w-20 rounded-md border border-line-strong bg-canvas px-2 py-1 text-ink disabled:opacity-50"
            />
          </label>

          <button
            type="button"
            onClick={() =>
              generate.mutate({
                count,
                mode: replace ? "replace" : "add",
              })
            }
            disabled={busy}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy
              ? "Generating…"
              : replace && existingCount > 0
                ? `Replace with ${count}`
                : replace
                  ? `Generate ${count}`
                  : `Add ${count}`}
          </button>
        </div>
      </div>

      <p className="text-sm text-ink-subtle">
        {busy ? "Generating" : "Will generate"} {count}{" "}
        {count === 1 ? "profile" : "profiles"} —{" "}
        {describePlan({ count, perRequest, maxConcurrent })}
      </p>

      {busy && replace && existingCount > 0 && (
        <p className="text-sm text-ink-muted">
          The {existingCount} previous{" "}
          {existingCount === 1 ? "profile" : "profiles"} have been deleted, with
          everything downstream of them.
        </p>
      )}

      {generate.error && (
        <p className="text-sm text-danger">{generate.error.message}</p>
      )}

      <RunProgress
        run={run}
        unit="profile"
        onCancel={cancel}
        cancelling={cancelling}
      />
    </div>
  );
}
