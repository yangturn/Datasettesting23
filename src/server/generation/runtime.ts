import "server-only";

/** Concurrent in-flight requests. Above this, OpenRouter starts rate-limiting. */
export const MAX_CONCURRENT_REQUESTS = 8;

/**
 * Whether a run wipes the stage's records first or extends them. Shared across
 * stages so "replace" means the same thing everywhere: delete this stage's own
 * output before generating, never a partial merge.
 */
export type GenerationMode = "replace" | "add";

/** Runs `task` over every item, at most `limit` in flight at once. */
export async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  task: (item: T) => Promise<R>,
): Promise<R[]> {
  const results = new Array<R>(items.length);
  let cursor = 0;

  const workers = Array.from(
    { length: Math.min(limit, items.length) },
    async () => {
      while (cursor < items.length) {
        const index = cursor++;
        results[index] = await task(items[index]);
      }
    },
  );

  await Promise.all(workers);
  return results;
}

/** Reads a positive-integer env var, falling back on anything unusable. */
export function positiveIntEnv(
  raw: string | undefined,
  fallback: number,
): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 ? parsed : fallback;
}

/**
 * Scenarios interleaved by person: one of each person's, then the next of each,
 * and so on.
 *
 * `listAllScenarios` groups by profile, so a limited run taking the head of that
 * list would spend its whole budget on the first person or two. What a small run
 * is worth looking at is the spread across biographies, so the limit should cut
 * across people rather than down one.
 *
 * Deterministic — profile ids sort, and each person's scenarios are already
 * newest-first — so raising the limit later keeps everything the smaller run did
 * and simply adds to it, rather than reshuffling into a different sample.
 */
export function interleaveByPerson<T extends { profile_id: string }>(
  items: T[],
): T[] {
  const byPerson = new Map<string, T[]>();
  for (const item of items) {
    const queue = byPerson.get(item.profile_id);
    if (queue) queue.push(item);
    else byPerson.set(item.profile_id, [item]);
  }

  const queues = [...byPerson.keys()].sort().map((key) => byPerson.get(key)!);
  const depth = queues.reduce((max, queue) => Math.max(max, queue.length), 0);

  const ordered: T[] = [];
  for (let round = 0; round < depth; round++) {
    for (const queue of queues) {
      if (round < queue.length) ordered.push(queue[round]);
    }
  }
  return ordered;
}
