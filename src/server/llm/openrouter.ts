import "server-only";

import { fetch as undiciFetch, ProxyAgent, type Dispatcher } from "undici";
import type { z } from "zod";

import { openRouterConfig } from "@/server/llm/env";

const ENDPOINT = "https://openrouter.ai/api/v1/chat/completions";

/**
 * Node's fetch ignores proxy environment variables, so a local proxy only takes
 * effect through an explicit dispatcher. Cached per URL — creating one agent per
 * request leaks sockets.
 */
const proxyAgents = new Map<string, ProxyAgent>();

function dispatcherFor(proxyUrl: string | undefined): Dispatcher | undefined {
  if (!proxyUrl) return undefined;

  let agent = proxyAgents.get(proxyUrl);
  if (!agent) {
    agent = new ProxyAgent(proxyUrl);
    proxyAgents.set(proxyUrl, agent);
  }
  return agent;
}

type ChatCompletion = {
  choices?: {
    message?: { content?: string; reasoning?: string; refusal?: string };
    finish_reason?: string | null;
    native_finish_reason?: string | null;
    /** A provider failure OpenRouter reports inside a 200 response. */
    error?: { code?: number | string; message?: string };
  }[];
  error?: { message?: string };
  provider?: string;
  usage?: {
    completion_tokens?: number;
    completion_tokens_details?: { reasoning_tokens?: number };
  };
};

/**
 * Says why a 200 response carried no content, from what the response does hold.
 *
 * An empty reply has several unrelated causes — the provider failing mid-stream,
 * the output budget spent entirely on reasoning, a refusal — and they call for
 * different fixes, so the bare fact that content was empty is not enough to act
 * on.
 */
function describeEmptyCompletion(payload: ChatCompletion): string {
  const choice = payload.choices?.[0];
  const details = [
    choice === undefined && "no choices",
    choice?.error &&
      `provider error ${choice.error.code ?? ""}: ${choice.error.message ?? "unknown"}`,
    choice?.finish_reason && `finish_reason ${choice.finish_reason}`,
    choice?.native_finish_reason &&
      choice.native_finish_reason !== choice.finish_reason &&
      `native_finish_reason ${choice.native_finish_reason}`,
    choice?.message?.refusal &&
      `refusal: ${choice.message.refusal.slice(0, 200)}`,
    choice?.message?.reasoning && "reasoning present",
    payload.usage?.completion_tokens !== undefined &&
      `${payload.usage.completion_tokens} completion tokens`,
    payload.usage?.completion_tokens_details?.reasoning_tokens !== undefined &&
      `${payload.usage.completion_tokens_details.reasoning_tokens} reasoning tokens`,
    payload.provider && `provider ${payload.provider}`,
  ].filter((detail): detail is string => Boolean(detail));

  return details.length > 0 ? ` (${details.join("; ")})` : "";
}

/**
 * Strips ```json fences some models emit despite being asked for raw JSON.
 * The fence is matched anywhere in the response, not just at the start, because
 * a model that prefaces it with "Here is the JSON:" is the common case — and
 * that leading sentence is exactly what makes `JSON.parse` fail.
 */
function stripCodeFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced ? fenced[1] : text).trim();
}

async function callOpenRouter(
  messages: { role: "system" | "user"; content: string }[],
  signal?: AbortSignal,
  temperature?: number,
): Promise<string> {
  const { apiKey, model, proxyUrl, providers } = openRouterConfig();

  const response = await undiciFetch(ENDPOINT, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model,
      messages,
      response_format: { type: "json_object" },
      // Every stage runs through this one client, so the benchmark compares
      // flows at a fixed reasoning budget rather than letting a reasoning model
      // spend more on whichever stage it finds hard.
      reasoning: { effort: "low" },
      // Omitted rather than defaulted, so a caller that says nothing keeps the
      // model's own default instead of one this client invented.
      ...(temperature === undefined ? {} : { temperature }),
      // An open model is hosted by many providers at different quantizations,
      // and OpenRouter picks among them per call. Restricting the set — with no
      // fallback outside it — is what makes two calls reach the same weights.
      ...(providers.length === 0
        ? {}
        : { provider: { only: providers, allow_fallbacks: false } }),
    }),
    dispatcher: dispatcherFor(proxyUrl),
    signal,
  });

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(
      `OpenRouter ${response.status} ${response.statusText}${
        detail ? `: ${detail.slice(0, 500)}` : ""
      }`,
    );
  }

  const payload = (await response.json()) as ChatCompletion;
  if (payload.error) {
    throw new Error(`OpenRouter error: ${payload.error.message ?? "unknown"}`);
  }

  const content = payload.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error(
      `OpenRouter returned no content${describeEmptyCompletion(payload)}.`,
    );
  }
  return content;
}

/**
 * Requests JSON and validates it against `schema`. A model that returns
 * malformed or off-schema JSON gets exactly one corrective retry — beyond that
 * the failure is real and should surface rather than be silently retried.
 */
export async function generateJson<T extends z.ZodType>({
  schema,
  system,
  prompt,
  signal,
  temperature,
}: {
  schema: T;
  system: string;
  prompt: string;
  signal?: AbortSignal;
  /**
   * Per-stage, because only some stages want it pinned. Stages 3 and 4 pass 0 —
   * a flow's action and a judge's score have to be reproducible for the grid to
   * be re-runnable; the earlier generative stages want the variety.
   */
  temperature?: number;
}): Promise<z.infer<T>> {
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];

  const ATTEMPTS = 2;
  let lastError: unknown;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const raw = await callOpenRouter(messages, signal, temperature);

    try {
      return schema.parse(JSON.parse(stripCodeFence(raw)));
    } catch (error) {
      lastError = error;
      // Only worth saying if another attempt will actually read it.
      if (attempt < ATTEMPTS - 1) {
        messages.push({
          role: "user",
          content:
            `Your previous response was not valid for the required schema.\n\n` +
            `Error:\n${error instanceof Error ? error.message : String(error)}\n\n` +
            `Return the corrected JSON object only — no prose, no code fences.`,
        });
      }
    }
  }

  throw new Error(
    `Model did not return schema-valid JSON after 2 attempts: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
  );
}

export function configuredModel(): string {
  return openRouterConfig().model;
}
