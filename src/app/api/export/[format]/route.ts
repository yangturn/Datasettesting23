import { buildExport, exportCsv } from "@/server/export";

/**
 * The hand-off bundle as a download.
 *
 *   /api/export/episodes.csv   one row per episode, one column per flow × score, columns named by paper name (SECOND_THOUGHT, FIVE_CALL_CONTROL, ...)
 *   /api/export/episodes.json  the same rows, plus the summary and prompts
 *
 * Built from disk on every request, so it is never older than the last run.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ format: string }> },
) {
  const { format } = await context.params;
  const bundle = await buildExport();

  if (format === "episodes.csv") {
    return new Response(exportCsv(bundle.rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="episodes.csv"',
      },
    });
  }

  if (format === "episodes.json") {
    return new Response(JSON.stringify(bundle, null, 2), {
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="episodes.json"',
      },
    });
  }

  return new Response("Unknown export. Use episodes.csv or episodes.json.", {
    status: 404,
  });
}
