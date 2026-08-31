import { z } from "zod";

/**
 * The pagination contract shared by every stage.
 *
 * Slicing happens in the router, never in the page: a listing that grows to
 * thousands of records should cost one page's worth of work per request, and a
 * page component that receives the whole set has already paid for all of it.
 *
 * Pages read `?page=`/`?size=` from the URL and pass them into the query; the
 * router returns the rows for that page plus the totals the UI needs.
 */

/** Rows per page when `?size=` is absent. */
export const DEFAULT_PAGE_SIZE = 3;

/** Selectable rows-per-page values. */
export const PAGE_SIZE_OPTIONS = [3, 5, 10, 25] as const;

/** Hard ceiling, so a hand-edited `?size=` can't ask for the whole table. */
export const MAX_PAGE_SIZE = 100;

/** What every paginated procedure accepts. */
export const paginationInputSchema = z.object({
  page: z.number().int().min(1).default(1),
  pageSize: z
    .number()
    .int()
    .min(1)
    .max(MAX_PAGE_SIZE)
    .default(DEFAULT_PAGE_SIZE),
});

export type PaginationInput = z.infer<typeof paginationInputSchema>;

/** What every paginated procedure returns, alongside any stage-specific counts. */
export type Page<T> = {
  rows: T[];
  /** The page actually served — clamped, so it may differ from what was asked. */
  page: number;
  pageSize: number;
  /** Size of the whole set, not of this page. */
  total: number;
  pageCount: number;
};

export function pageCountOf(total: number, pageSize: number): number {
  return Math.max(1, Math.ceil(total / pageSize));
}

/**
 * Slices one page out of a full set. Out-of-range pages clamp into range rather
 * than returning nothing — a run that shrinks the population, or a larger page
 * size, would otherwise strand you past the last page.
 */
export function paginate<T>(items: T[], input: PaginationInput): Page<T> {
  const { pageSize } = input;
  const total = items.length;
  const pageCount = pageCountOf(total, pageSize);
  const page = Math.min(Math.max(1, input.page), pageCount);
  const start = (page - 1) * pageSize;

  return {
    rows: items.slice(start, start + pageSize),
    page,
    pageSize,
    total,
    pageCount,
  };
}

/**
 * Reads `?size=`, falling back to the default for anything not on the menu —
 * a hand-edited URL can't put the listing into a size the control can't undo.
 */
export function pageSizeFromParam(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(value)
    ? value
    : DEFAULT_PAGE_SIZE;
}

/**
 * Reads a `?page=` style param. Only the lower bound is enforced here; the
 * upper bound needs the total, which only the router knows, so it clamps and
 * reports back the page it actually served.
 */
export function pageFromParam(raw: string | string[] | undefined): number {
  const value = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isInteger(value) && value >= 1 ? value : 1;
}
