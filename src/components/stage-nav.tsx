import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * Pointer to the next pipeline stage. Stages that aren't built yet render as
 * inert cards so they don't dead-end into a 404.
 */
export function NextStagePointer({
  stage,
  title,
  description,
  href,
}: {
  stage: string;
  title: string;
  description: string;
  href?: string;
}) {
  const body = (
    <>
      <div className="space-y-1">
        <p className="text-xs font-semibold tracking-wide text-ink-subtle uppercase">
          Next · {stage}
        </p>
        <p className="text-sm font-medium text-ink">{title}</p>
        <p className="text-sm text-ink-muted">{description}</p>
      </div>
      <span
        aria-hidden
        className="text-lg text-ink-subtle transition-transform group-hover:translate-x-0.5"
      >
        →
      </span>
    </>
  );

  const base =
    "group flex items-center justify-between gap-6 rounded-lg border p-4";

  if (!href) {
    return (
      <div className={cn(base, "border-dashed border-line-strong")}>
        {body}
        <span className="sr-only">Not built yet</span>
      </div>
    );
  }

  return (
    <Link
      href={href}
      className={cn(
        base,
        "border-line bg-surface-raised hover:border-accent hover:bg-surface-hover",
      )}
    >
      {body}
    </Link>
  );
}
