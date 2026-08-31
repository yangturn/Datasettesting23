"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";

/**
 * Rows-per-page control. Writes to the query string so the choice is part of the
 * URL — shareable, survives a `router.refresh()` after a generation run, and
 * read server-side where the slicing happens.
 */
export function PageSizeSelect({
  size,
  options,
  pageParams,
}: {
  size: number;
  options: readonly number[];
  /** Page-number params to clear, so a size change lands you back on page 1. */
  pageParams: readonly string[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  return (
    <label className="flex items-center gap-2 text-ink-subtle">
      show
      <select
        value={size}
        onChange={(event) => {
          const params = new URLSearchParams(searchParams);
          params.set("size", event.target.value);
          for (const param of pageParams) params.delete(param);
          router.push(`${pathname}?${params}`);
        }}
        className="rounded-md border border-line-strong bg-canvas px-2 py-1 text-ink"
      >
        {options.map((option) => (
          <option key={option} value={option}>
            {option}
          </option>
        ))}
      </select>
    </label>
  );
}
