import "server-only";

import { AnthropicProvider } from "./anthropic-provider";
import { OpenAIProvider } from "./openai-provider";
import { MockProvider } from "./mock-provider";
import type { AccountingAIProvider } from "./types";

export * from "./types";
export { AnthropicProvider, OpenAIProvider, MockProvider };

/** The documented default. Overridable with ANTHROPIC_MODEL. */
const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5";

let cached: AccountingAIProvider | null = null;

/**
 * Returns the configured provider, falling back to the deterministic mock when
 * no key is present. The fallback is loud on purpose — silently degrading to a
 * keyword matcher in production would be far worse than an obvious log line.
 *
 * Anthropic is the documented provider; OpenAI stays wired behind the same
 * interface for deployments already configured that way. Which one ran is
 * recorded on every classification, so a report's lineage stays truthful when
 * an environment switches.
 */
export function getAIProvider(): AccountingAIProvider {
  if (cached) return cached;

  const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
  if (anthropicKey) {
    const model = process.env.ANTHROPIC_MODEL?.trim() || DEFAULT_ANTHROPIC_MODEL;
    cached = new AnthropicProvider(anthropicKey, model);
    return cached;
  }

  const openaiKey = process.env.OPENAI_API_KEY?.trim();
  const openaiModel = process.env.OPENAI_MODEL?.trim();
  if (openaiKey && openaiModel) {
    cached = new OpenAIProvider(openaiKey, openaiModel);
    return cached;
  }

  console.warn(
    openaiKey
      ? "[ai] OPENAI_MODEL not set and no ANTHROPIC_API_KEY — using MockProvider (deterministic keyword matching, no API calls)."
      : "[ai] ANTHROPIC_API_KEY not set — using MockProvider (deterministic keyword matching, no API calls).",
  );
  cached = new MockProvider();
  return cached;
}

/** Test seam. */
export function setAIProvider(p: AccountingAIProvider | null): void {
  cached = p;
}
