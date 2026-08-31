import "server-only";

/**
 * Model and credentials are read from the environment at call time — never
 * hardcoded at a call site, so the whole benchmark can be re-run against a
 * different model by changing one variable.
 */
export function openRouterConfig() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  const model = process.env.OPENROUTER_MODEL;

  if (!apiKey) {
    throw new Error(
      "OPENROUTER_API_KEY is not set. Add it to .env (see .env.example).",
    );
  }
  if (!model) {
    throw new Error(
      "OPENROUTER_MODEL is not set. Add it to .env (see .env.example).",
    );
  }

  return {
    apiKey,
    model,
    proxyUrl: process.env.OPENROUTER_PROXY_URL || undefined,
  };
}
