import Link from "next/link";

import { PageSizeSelect } from "@/components/ui/page-size-select";
import { PAGE_SIZE_OPTIONS, pageCountOf } from "@/lib/pagination";

/**
 * Page controls for a listing. `hrefFor` builds the target URL, so a page with
 * two independent listings can keep both positions in the query string.
 *
 * Takes the totals the router reported rather than an array to measure — the
 * rows it sits under are only the current page.
 */
export function Pagination({
  page,
  total,
  pageSize,
  unit,
  hrefFor,
  pageParams,
}: {
  page: number;
  total: number;
  pageSize: number;
  /** Plural noun for the counter, e.g. "profiles". */
  unit: string;
  hrefFor: (page: number) => string;
  /** Page-number params this page uses, reset when the size changes. */
  pageParams: readonly string[];
}) {
  if (total === 0) return null;

  const pageCount = pageCountOf(total, pageSize);
  const first = (page - 1) * pageSize + 1;
  const last = Math.min(page * pageSize, total);

  const linkClass =
    "rounded-md border border-line px-2.5 py-1 text-ink-muted hover:border-accent hover:text-accent";
  const disabledClass =
    "rounded-md border border-dashed border-line px-2.5 py-1 text-ink-subtle";

  return (
    <nav
      aria-label={`${unit} pagination`}
      className="flex flex-wrap items-center justify-between gap-3 text-sm"
    >
      <div className="flex flex-wrap items-center gap-4">
        <p className="text-ink-subtle">
          {first}–{last} of {total} {unit}
        </p>
        <PageSizeSelect
          size={pageSize}
          options={PAGE_SIZE_OPTIONS}
          pageParams={pageParams}
        />
      </div>

      {pageCount > 1 && (
        <div className="flex items-center gap-2">
          {page > 1 ? (
            <Link href={hrefFor(page - 1)} className={linkClass} rel="prev">
              ← Prev
            </Link>
          ) : (
            <span className={disabledClass}>← Prev</span>
          )}

          <span className="text-ink-muted">
            Page {page} of {pageCount}
          </span>

          {page < pageCount ? (
            <Link href={hrefFor(page + 1)} className={linkClass} rel="next">
              Next →
            </Link>
          ) : (
            <span className={disabledClass}>Next →</span>
          )}
        </div>
      )}
    </nav>
  );
}
