import "server-only";

/**
 * Recognise "the database is behind the schema" and say so plainly.
 *
 * Prisma reports a missing table or column as P2021 / P2022. Left alone that
 * surfaces as a raw stack trace on every page; here it becomes one sentence
 * with the commands that fix it. Local development pushes the schema;
 * staging and production run migrations.
 */

export const SCHEMA_BEHIND_MESSAGE =
  "The database schema is behind prisma/schema.prisma. " +
  "Run `npx prisma db push --accept-data-loss`, then `pnpm db:constraints`, then `pnpm db:seed`, and restart the dev server. " +
  "On staging or production run `prisma migrate deploy` instead.";

export class SchemaBehindError extends Error {
  readonly missing: string | null;
  constructor(missing: string | null) {
    super(missing ? `${SCHEMA_BEHIND_MESSAGE} (missing: ${missing})` : SCHEMA_BEHIND_MESSAGE);
    this.name = "SchemaBehindError";
    this.missing = missing;
  }
}

/** Rethrow a Prisma "table/column does not exist" as a SchemaBehindError; anything else passes through. */
export function rethrowIfSchemaBehind(error: unknown): never {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    if (code === "P2021" || code === "P2022") {
      const meta = (error as { meta?: { table?: unknown; column?: unknown; modelName?: unknown } }).meta;
      const missing = [meta?.modelName, meta?.table, meta?.column].find((v) => typeof v === "string") as string | undefined;
      console.error(`[db] ${SCHEMA_BEHIND_MESSAGE}`);
      throw new SchemaBehindError(missing ?? null);
    }
  }
  throw error;
}
