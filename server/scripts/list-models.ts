/**
 * Lists the models the configured account can actually use.
 *
 * `npm run ai:models`
 *
 * Model ids change often, so this asks the API rather than relying on a
 * hardcoded guess. Put the one you want in ANTHROPIC_MODEL (or OPENAI_MODEL)
 * in .env. With neither key set there is nothing to ask.
 *
 * Each provider is listed independently: a bad key for one must not hide the
 * other, because the usual reason for running this is that a key is wrong.
 */
import Anthropic from "@anthropic-ai/sdk";
import OpenAI from "openai";

// The environment may already be set (CI, a host): a missing .env is not an error.
try {
  process.loadEnvFile(".env");
} catch {
  // .env is absent — the environment is expected to provide the variables.
}

const anthropicKey = process.env.ANTHROPIC_API_KEY?.trim();
const openaiKey = process.env.OPENAI_API_KEY?.trim();

if (!anthropicKey && !openaiKey) {
  console.error("\n  Neither ANTHROPIC_API_KEY nor OPENAI_API_KEY is set in .env\n");
  process.exit(1);
}

let failures = 0;

async function listAnthropic(key: string): Promise<void> {
  const client = new Anthropic({ apiKey: key });
  const models = [];
  for await (const model of client.models.list()) models.push(model);

  console.log(`\nAnthropic — ${models.length} models available:\n`);
  for (const m of models) console.log(`  ${m.id.padEnd(28)} ${m.display_name}`);
  console.log(`\n  Set ANTHROPIC_MODEL in .env. The classifier is tuned for claude-opus-5.\n`);
}

async function listOpenAI(key: string): Promise<void> {
  const client = new OpenAI({ apiKey: key });
  const page = await client.models.list();
  const ids = page.data.map((m) => m.id).sort();

  // Reasoning/chat families first — those are what the classifier needs.
  const relevant = ids.filter((id) => /^(gpt|o\d|chatgpt)/i.test(id));

  console.log(`\nOpenAI — ${relevant.length} chat/reasoning models available:\n`);
  for (const id of relevant) console.log(`  ${id}`);
  console.log(`\n  Set OPENAI_MODEL in .env. Used only when ANTHROPIC_API_KEY is absent.\n`);
}

async function run(label: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (e) {
    failures += 1;
    console.error(`\n  ${label} lookup failed: ${e instanceof Error ? e.message : String(e)}\n`);
  }
}

if (anthropicKey) await run("Anthropic", () => listAnthropic(anthropicKey));
if (openaiKey) await run("OpenAI", () => listOpenAI(openaiKey));

if (failures > 0) process.exit(1);
