import { Separator } from "radix-ui";

import { cn } from "@/lib/utils";

export function Section({
  id,
  title,
  description,
  children,
  className,
}: {
  /** Anchor target, so in-page links (e.g. pagination) can scroll here. */
  id?: string;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section id={id} className={cn("scroll-mt-6 space-y-4", className)}>
      <div className="space-y-1">
        <h2 className="text-sm font-semibold tracking-wide text-ink-muted uppercase">
          {title}
        </h2>
        {description && <p className="text-sm text-ink-subtle">{description}</p>}
      </div>
      <Separator.Root className="h-px bg-line" />
      {children}
    </section>
  );
}

export function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div className="grid gap-1 sm:grid-cols-[10rem_1fr] sm:gap-4">
      <dt className="text-sm font-medium text-ink-muted">{label}</dt>
      <dd className="text-sm leading-relaxed text-ink">{children}</dd>
    </div>
  );
}

export function Tag({ children }: { children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs text-ink-muted">
      {children}
    </span>
  );
}
