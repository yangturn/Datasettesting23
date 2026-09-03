import "server-only";

import { randomUUID } from "node:crypto";
import { rename, rm, writeFile } from "node:fs/promises";

/**
 * Writes a JSON record so a concurrent reader never sees it half-written.
 *
 * `writeFile` on an existing path truncates first and fills after, so there is
 * a window in which the file on disk is empty or cut off mid-token. Nothing in
 * this project reads at a quiet moment: a run rewrites a record after every
 * step, while `run-progress` refreshes the route while the run is still going,
 * so the Stage 3 and Stage 4 listings read exactly the files being rewritten.
 * A reader landing in that window gets a `SyntaxError` out of `JSON.parse` — a
 * crash about malformed data, on a file that is in fact fine a millisecond
 * later.
 *
 * Writing beside the target and renaming over it closes the window: a rename is
 * atomic, so a reader sees either the previous complete record or the new one.
 * The temp name ends in `.tmp` because every listing here filters for `.json`,
 * which keeps a half-written file out of the listings as well as out of parses.
 *
 * `runs.ts` already serialises writer against writer for the same reason. This
 * is the other half — writer against reader — and the two are independent.
 */
export async function writeJsonFile(
  file: string,
  value: unknown,
): Promise<void> {
  const temp = `${file}.${randomUUID()}.tmp`;
  const body = `${JSON.stringify(value, null, 2)}\n`;

  await writeFile(temp, body, "utf8");

  try {
    await renameWithRetry(temp, file);
  } catch (error) {
    if (!isContended(error)) {
      // The temp file is this call's alone, so removing it strands nothing.
      await rm(temp, { force: true }).catch(() => {});
      throw error;
    }

    // Windows will not replace a file while anything holds it open, and a
    // reader that never pauses holds it open indefinitely — no amount of
    // retrying wins that. Writing in place is the old behaviour: it reopens
    // the torn-read window this function exists to close, but the caller is a
    // run that has already paid for a model call, and losing that output is
    // the worse of the two failures. The route refresh this normally contends
    // with leaves gaps, and the rename takes them, so this stays a last resort.
    await writeFile(file, body, "utf8");
    await rm(temp, { force: true }).catch(() => {});
  }
}

/**
 * Windows fails a replacing rename with EPERM or EBUSY when anything else holds
 * the target open — a reader mid-`readFile`, or a virus scanner that opened the
 * file the moment it was written. Both normally clear within milliseconds, so
 * retrying turns a spurious crash into a pause.
 *
 * Deliberately short — about 160ms in total. Its only job is to outlast a
 * holder that is genuinely transient; a reader that never pauses is not, and
 * no ladder wins that. Waiting longer would just stall every step write behind
 * a full ladder before reaching the fallback the caller already has.
 */
async function renameWithRetry(from: string, to: string): Promise<void> {
  const DELAYS_MS = [5, 15, 40, 100];

  for (let attempt = 0; ; attempt++) {
    try {
      await rename(from, to);
      return;
    } catch (error) {
      if (!isContended(error) || attempt >= DELAYS_MS.length) throw error;
      await new Promise((resolve) => setTimeout(resolve, DELAYS_MS[attempt]));
    }
  }
}

function isContended(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException).code;
  return code === "EPERM" || code === "EBUSY" || code === "EACCES";
}
