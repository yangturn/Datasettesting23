import type { FetchCreateContextFnOptions } from "@trpc/server/adapters/fetch";

/**
 * Request-scoped context available to every procedure.
 * Add db clients, session/auth, etc. here as the flow requires.
 */
export async function createContext(opts: FetchCreateContextFnOptions) {
  return {
    headers: opts.req.headers,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;
