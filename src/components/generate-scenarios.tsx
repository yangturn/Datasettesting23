"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";

import { RunProgress, useRun } from "@/components/run-progress";
import { trpc } from "@/trpc/client";

export function GenerateScenarios({
  personCount,
  existingCount,
  defaultPerPerson,
  maxPerPerson,
  contextMaxItems,
  maxConcurrent,
}: {
  personCount: number;
  existingCount: number;
  defaultPerPerson: number;
  maxPerPerson: number;
  contextMaxItems: number;
  maxConcurrent: number;
}) {
  const [perPerson, setPerPerson] = useState(() =>
    Math.min(defaultPerPerson, maxPerPerson),
  );
  // Defaults off, unlike Stage 0's: appending is what this stage did before the
  // toggle existed, and deleting a population's worth of scenarios costs two
  // model calls each to rebuild.
  const [replace, setReplace] = useState(false);
  const { run, running, adopt, cancel, cancelling } = useRun("scenarios");

  // The mutation returns as soon as the run exists; the run itself outlives
  // this request, so progress comes from polling rather than from awaiting it.
  const generate = trpc.scenarios.generate.useMutation({
    onSuccess: (record) => adopt(record),
  });

  const busy = generate.isPending || running;

  const total = personCount * perPerson;
  const parallelism =
    personCount <= maxConcurrent
      ? "all people in parallel"
      : `${maxConcurrent} people in parallel at a time`;

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface p-4">
      {/* The text column absorbs its own wrapping (min-w-0 flex-1) so a longer
          message never pushes the controls onto a second row. */}
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-1">
          <p className="text-sm font-medium text-ink">Scenario generator</p>
          <p className="text-sm text-ink-muted">
            Runs across all {personCount}{" "}
            {personCount === 1 ? "person" : "people"} with a Stage 1
            description.{" "}
            {replace && existingCount > 0 ? (
              <span className="text-danger">
                Deletes all {existingCount} existing{" "}
                {existingCount === 1 ? "scenario" : "scenarios"} first.
              </span>
            ) : (
              existingCount > 0 && (
                <>
                  Adds to the {existingCount} existing{" "}
                  {existingCount === 1 ? "scenario" : "scenarios"}.
                </>
              )
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
            per person
            <input
              type="number"
              min={1}
              max={maxPerPerson}
              value={perPerson}
              onChange={(event) =>
                setPerPerson(
                  Math.min(
                    maxPerPerson,
                    Math.max(
                      1,
                      Math.trunc(Number(event.target.value)) || 1,
                    ),
                  ),
                )
              }
              disabled={busy}
              className="w-16 rounded-md border border-line-strong bg-canvas px-2 py-1 text-ink disabled:opacity-50"
            />
          </label>

          <button
            type="button"
            onClick={() =>
              generate.mutate({
                perPerson,
                mode: replace ? "replace" : "add",
              })
            }
            disabled={busy || personCount === 0}
            className="inline-flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-accent-ink hover:bg-accent-hover disabled:opacity-50"
          >
            {busy && <Loader2 className="size-4 animate-spin" aria-hidden />}
            {busy
              ? "Generating…"
              : replace && existingCount > 0
                ? `Replace with ${total}`
                : existingCount > 0
                  ? `Add ${total}`
                  : `Generate ${total}`}
          </button>
        </div>
      </div>

      <p className="text-sm text-ink-subtle">
        {busy ? "Generating" : "Will generate"} {total}{" "}
        {total === 1 ? "scenario" : "scenarios"} — two model calls each, a
        situation then up to {contextMaxItems} context items per field, so{" "}
        {total * 2} calls in total. Runs {parallelism}, with a person&apos;s own
        scenarios in sequence so each takes the next situation type and life
        domain in the rotation.
      </p>

      {busy && replace && existingCount > 0 && (
        <p className="text-sm text-ink-muted">
          The {existingCount} previous{" "}
          {existingCount === 1 ? "scenario" : "scenarios"} have been deleted.
        </p>
      )}

      {generate.error && (
        <p className="text-sm text-danger">{generate.error.message}</p>
      )}

      <RunProgress
        run={run}
        unit="scenario"
        onCancel={cancel}
        cancelling={cancelling}
      />
    </div>
  );
}
