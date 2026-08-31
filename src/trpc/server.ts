import "server-only";

import { headers } from "next/headers";

import { appRouter } from "@/server/routers/_app";
import { createCallerFactory } from "@/server/trpc";

/**
 * Direct server-side caller — use inside Server Components / route handlers
 * to call procedures without an HTTP round trip.
 */
export async function getServerCaller() {
  const createCaller = createCallerFactory(appRouter);
  return createCaller({ headers: await headers() });
}
