import type { Metadata } from "next";
import Link from "next/link";

import type { DigitalTwinEvaluationView } from "@/lib/digital-twin-stage-4";
import { getServerCaller } from "@/trpc/server";

export const metadata: Metadata = { title: "Stage 4 · Digital Twin Evaluation" };
export const dynamic = "force-dynamic";

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
}

function EvaluationView({ evaluation }: { evaluation: DigitalTwinEvaluationView }) {
  return (
    <section className="space-y-5 rounded-lg border border-line bg-canvas p-5">
      <div>
        <h2 className="text-lg font-semibold text-ink">{evaluation.label}</h2>
        <p className="mt-1 text-sm text-ink-muted">{evaluation.description}</p>
        <p className="mt-1 text-xs text-ink-subtle">
          {evaluation.heldOutAnswers} assigned answers available for this ground truth.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line">
        <table className="w-full text-sm">
          <thead className="bg-surface text-left text-ink-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Method</th>
              <th className="px-4 py-3 font-medium">Normalized accuracy</th>
              <th className="px-4 py-3 font-medium">Exact match</th>
              <th className="px-4 py-3 font-medium">Answers compared</th>
              <th className="px-4 py-3 font-medium">Participants</th>
              <th className="px-4 py-3 font-medium">Tasks</th>
            </tr>
          </thead>
          <tbody>
            {evaluation.methods.map((method) => (
              <tr key={method.key} className="border-t border-line bg-surface-raised">
                <td className="px-4 py-3 font-medium text-ink">
                  {method.label}
                  {method.kind === "published-baseline" && (
                    <span className="ml-2 rounded border border-line-strong px-1.5 py-0.5 text-xs font-normal text-ink-subtle">
                      published predictions
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-ink">{percent(method.accuracy)}</td>
                <td className="px-4 py-3 text-ink">{percent(method.exactMatch)}</td>
                <td className="px-4 py-3 text-ink-muted">{method.comparedAnswers}</td>
                <td className="px-4 py-3 text-ink-muted">{method.participants}</td>
                <td className="px-4 py-3 text-ink-muted">{method.tasks}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="space-y-2">
        <h3 className="font-medium text-ink">Task breakdown</h3>
        <div className="overflow-x-auto rounded-lg border border-line">
          <table className="w-full text-sm">
            <thead className="bg-surface text-left text-ink-muted">
              <tr>
                <th className="sticky left-0 bg-surface px-4 py-3 font-medium">Task</th>
                {evaluation.methods.map((method) => (
                  <th key={method.key} className="min-w-36 px-4 py-3 font-medium">
                    {method.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {evaluation.tasks.map((task) => (
                <tr key={task.taskKey} className="border-t border-line bg-surface-raised">
                  <td className="sticky left-0 bg-surface-raised px-4 py-3 font-medium text-ink">
                    {task.taskLabel}
                  </td>
                  {evaluation.methods.map((method) => {
                    const score = task.methods[method.key];
                    return (
                      <td key={method.key} className="px-4 py-3 text-ink">
                        <span>{percent(score?.accuracy ?? null)}</span>
                        {score?.comparedAnswers ? (
                          <span className="ml-1 text-xs text-ink-subtle">
                            ({score.comparedAnswers})
                          </span>
                        ) : null}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  );
}

export default async function DigitalTwinStage4Page() {
  const trpc = await getServerCaller();
  const report = await trpc.digitalTwins.stage4Report();

  return (
    <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-6 py-12">
      <header className="max-w-3xl space-y-2">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">Digital Twins · Stage 4</p>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Evaluation</h1>
        <p className="text-sm text-ink-muted">
          Deterministically compare the same assigned Stage 3 answers with two
          ground truths: Wave 4 for future-response prediction and Wave 1–3 for
          compatibility with the published experiment. No LLM calls are made.
        </p>
      </header>

      {report === null ? (
        <p className="rounded-lg border border-dashed border-line-strong p-6 text-sm text-ink-muted">
          Complete <Link href="/digital-twins/stage-0" className="text-accent hover:underline">Stage 0</Link> first.
        </p>
      ) : (
        <>
          {!report.baseline.available && (
            <p className="rounded-lg border border-danger/40 bg-surface p-4 text-sm text-danger">
              Published Digital Twin results could not be loaded: {report.baseline.error}
            </p>
          )}

          {report.selectedParticipants === 0 && (
            <p className="rounded-lg border border-line-strong bg-surface p-4 text-sm text-ink-muted">
              No assigned-only episodes are ready to evaluate. Regenerate Stage 2,
              then rerun Stage 3; artifacts made by the previous all-conditions
              adapter are intentionally excluded.
            </p>
          )}

          <p className="text-sm text-ink-muted">
            {report.selectedParticipants} selected participants. Missing human
            answers and predictions remain visible through each method&apos;s answer
            coverage.
          </p>

          {report.evaluations.map((evaluation) => (
            <EvaluationView key={evaluation.key} evaluation={evaluation} />
          ))}

          <section className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-muted">
            <p className="font-medium text-ink">Method</p>
            <p className="mt-1">Normalized accuracy is <span className="font-mono">1 − |prediction − ground truth| / response range</span>. Matching the official evaluator, binary anchoring setup questions are excluded and numeric anchoring estimates are converted to deciles derived from the evaluated sample. Scores are averaged within tasks, across tasks, then across participants.</p>
            <p className="mt-2">The published row contains the authors&apos; fixed GPT‑4.1-mini predictions from pinned dataset revision <span className="font-mono">{report.baseline.revision.slice(0, 12)}</span>. The Wave 4 view is a new rescore of those predictions; the Wave 1–3 view matches the paper&apos;s ground-truth definition. <a href={report.baseline.sourceUrl} className="text-accent hover:underline">Source CSV</a></p>
          </section>
        </>
      )}
    </main>
  );
}
