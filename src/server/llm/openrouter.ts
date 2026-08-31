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
  choices?: { message?: { content?: string } }[];
  error?: { message?: string };
};

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
): Promise<string> {
  const { apiKey, model, proxyUrl } = openRouterConfig();

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
    throw new Error("OpenRouter returned no content.");
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
}: {
  schema: T;
  system: string;
  prompt: string;
  signal?: AbortSignal;
}): Promise<z.infer<T>> {
  const messages: { role: "system" | "user"; content: string }[] = [
    { role: "system", content: system },
    { role: "user", content: prompt },
  ];

  const ATTEMPTS = 2;
  let lastError: unknown;

  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const raw = await callOpenRouter(messages, signal);

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
