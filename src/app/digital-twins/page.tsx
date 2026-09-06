import type { Metadata } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Digital-Twins",
  description: "Evaluate digital twins against participant survey responses.",
};

const STAGES = [
  {
    stage: "Stage 0",
    title: "Profile Generation",
    description:
      "Choose a seeded random sample of real Twin-2K-500 participants.",
    href: "/digital-twins/stage-0",
  },
  {
    stage: "Stage 1",
    title: "Person / Population Creation",
    description:
      "Transform each participant's survey evidence into a DatasetTesting persona.",
  },
  {
    stage: "Stage 2",
    title: "Episode Creation",
    description: "Build the decision context used by the DatasetTesting flows.",
  },
  {
    stage: "Stage 3",
    title: "Flow Execution",
    description: "Predict the participants' held-out survey responses.",
  },
  {
    stage: "Stage 4",
    title: "Evaluation",
    description: "Compare predictions using the Digital Twin benchmark scorer.",
  },
] as const;

export default function DigitalTwinsPage() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Digital-Twins
        </h1>
        <p className="text-sm text-ink-muted">
          Test whether DatasetTesting can predict held-out survey answers more
          accurately than the original Digital Twin methodology.
        </p>
      </div>

      <ol className="space-y-2">
        {STAGES.map(({ stage, title, description, ...item }) => {
          const href = "href" in item ? item.href : undefined;
          const body = (
            <>
              <div className="space-y-1">
                <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
                  {stage}
                </p>
                <p className="text-sm font-medium text-ink">{title}</p>
                <p className="text-sm text-ink-muted">{description}</p>
              </div>
              <span aria-hidden className="text-lg text-ink-subtle">
                →
              </span>
            </>
          );

          return (
            <li key={stage}>
              {href ? (
                <Link
                  href={href}
                  className="flex items-center justify-between gap-6 rounded-lg border border-line bg-surface-raised p-4 hover:border-accent hover:bg-surface-hover"
                >
                  {body}
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-6 rounded-lg border border-dashed border-line-strong p-4">
                  {body}
                  <span className="sr-only">Not built yet</span>
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </main>
  );
}
