import type { Metadata } from "next";
import Link from "next/link";

import { getServerCaller } from "@/trpc/server";

export const metadata: Metadata = { title: "Stage 4 · Digital Twin Evaluation" };
export const dynamic = "force-dynamic";

function percent(value: number | null): string {
  return value === null ? "—" : `${(value * 100).toFixed(1)}%`;
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
          Deterministically compare Stage 3 predictions with the held-out Wave 4 responses. No LLM calls are made. The headline metric follows the original normalized mean-absolute-difference method and balances task families within each participant.
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

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Scoreboard</h2>
              <p className="text-sm text-ink-muted">
                {report.selectedParticipants} participants · {report.heldOutAnswers} available held-out answers. Missing human answers and missing predictions are excluded and reported through coverage.
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
                  {report.methods.map((method) => (
                    <tr key={method.key} className="border-t border-line bg-surface-raised">
                      <td className="px-4 py-3 font-medium text-ink">
                        {method.label}
                        {method.kind === "published-baseline" && <span className="ml-2 rounded border border-line-strong px-1.5 py-0.5 text-xs font-normal text-ink-subtle">published baseline</span>}
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
          </section>

          <section className="space-y-3">
            <div>
              <h2 className="text-lg font-semibold text-ink">Task breakdown</h2>
              <p className="text-sm text-ink-muted">Normalized accuracy by held-out task. A dash means that method has no completed prediction to score.</p>
            </div>
            <div className="overflow-x-auto rounded-lg border border-line">
              <table className="w-full text-sm">
                <thead className="bg-surface text-left text-ink-muted">
                  <tr>
                    <th className="sticky left-0 bg-surface px-4 py-3 font-medium">Task</th>
                    {report.methods.map((method) => <th key={method.key} className="min-w-36 px-4 py-3 font-medium">{method.label}</th>)}
                  </tr>
                </thead>
                <tbody>
                  {report.tasks.map((task) => (
                    <tr key={task.taskKey} className="border-t border-line bg-surface-raised">
                      <td className="sticky left-0 bg-surface-raised px-4 py-3 font-medium text-ink">{task.taskLabel}</td>
                      {report.methods.map((method) => {
                        const score = task.methods[method.key];
                        return <td key={method.key} className="px-4 py-3 text-ink"><span>{percent(score?.accuracy ?? null)}</span>{score?.comparedAnswers ? <span className="ml-1 text-xs text-ink-subtle">({score.comparedAnswers})</span> : null}</td>;
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>

          <section className="rounded-lg border border-line bg-surface p-4 text-sm text-ink-muted">
            <p className="font-medium text-ink">Method</p>
            <p className="mt-1">Normalized accuracy is <span className="font-mono">1 − |prediction − Wave 4| / response range</span>. Anchoring estimates use the original repository&apos;s Wave 1–3 decile transformation. Scores are averaged within tasks, then across tasks, then across participants.</p>
            <p className="mt-2">The Digital-Twin-Simulation row uses the authors&apos; published GPT‑4.1-mini predictions from pinned dataset revision <span className="font-mono">{report.baseline.revision.slice(0, 12)}</span>. <a href={report.baseline.sourceUrl} className="text-accent hover:underline">Source CSV</a></p>
          </section>
        </>
      )}
    </main>
  );
}
