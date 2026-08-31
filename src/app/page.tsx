import Link from "next/link";

const STAGES = [
  {
    stage: "Stage 0",
    title: "Profile Generation",
    description: "Short, deliberately diverse sketches of who each person is.",
    href: "/stage-0",
  },
  {
    stage: "Stage 1",
    title: "Person / Population Creation",
    description:
      "Each sketch expanded into the canonical long description.",
    href: "/stage-1",
  },
  {
    stage: "Stage 2",
    title: "Episode Creation",
    description:
      "A situation per person, plus the facts it puts in play.",
    href: "/stage-2",
  },
  {
    stage: "Stage 3",
    title: "Flow Execution",
    description:
      "Each episode run through every candidate decision flow, part by part.",
    href: "/stage-3",
  },
  {
    stage: "Stage 4",
    title: "Evaluation",
    description:
      "A neutral context per scenario, then each flow's prediction scored against it.",
    href: "/stage-4",
  },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center gap-8 px-6 py-16">
      <div className="space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">
          Generator
        </h1>
        <p className="text-sm text-ink-muted">
          A testbed for comparing AI flows on predicting human behavior. Each
          stage consumes the full output of the stages before it.
        </p>
      </div>

      <ol className="space-y-2">
        {STAGES.map(({ stage, title, description, href }) => {
          const body = (
            <>
              <div className="space-y-1">
                <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
                  {stage}
                </p>
                <p className="text-sm font-medium text-ink">{title}</p>
                <p className="text-sm text-ink-muted">{description}</p>
              </div>
              {href && (
                <span aria-hidden className="text-lg text-ink-subtle">
                  →
                </span>
              )}
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
                </div>
              )}
            </li>
          );
        })}
      </ol>
    </main>
  );
}
