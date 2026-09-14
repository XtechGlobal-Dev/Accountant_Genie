import "server-only";

/**
 * Two failure modes, kept apart because they need different answers.
 *
 * A `FiskilConfigError` is our fault — a missing or wrong credential — and the
 * UI should say so plainly rather than blaming the client's bank. A
 * `FiskilApiError` came back from Fiskil and may be transient.
 */

export class FiskilConfigError extends Error {
  readonly kind = "config";
  constructor(message: string) {
    super(message);
    this.name = "FiskilConfigError";
  }
}

export interface FiskilErrorBody {
  id?: string;
  name?: string;
  message?: string;
  /** v1/v2 only; v3 dropped these from the Core Resources list endpoints. */
  temporary?: boolean;
  timeout?: boolean;
  fault?: boolean;
}

export class FiskilApiError extends Error {
  readonly kind = "api";
  constructor(
    readonly status: number,
    readonly body: FiskilErrorBody | string,
    readonly path: string,
  ) {
    super(
      typeof body === "string"
        ? `Fiskil ${status} on ${path}: ${body.slice(0, 200)}`
        : `Fiskil ${status} on ${path}: ${body.name ?? "error"} — ${body.message ?? ""}`,
    );
    this.name = "FiskilApiError";
  }

  /** Worth retrying: the provider said so, or it is a 5xx / rate limit. */
  get retryable(): boolean {
    if (typeof this.body !== "string" && (this.body.temporary || this.body.timeout)) return true;
    return this.status === 429 || this.status >= 500;
  }
}

/**
 * What to show an accountant. Fiskil's own messages name internal resources,
 * so they are kept for the log and this is kept for the screen.
 */
export function feedErrorMessage(error: unknown): string {
  if (error instanceof FiskilConfigError) return error.message;
  if (error instanceof FiskilApiError) {
    if (error.status === 404) return "Fiskil has no record of this connection. It may have been revoked.";
    if (error.status === 429) return "Fiskil is rate limiting us. Try again in a few minutes.";
    if (error.retryable) return "Fiskil is temporarily unavailable. The sync will be retried.";
    return "Fiskil rejected the request. Check the connection and try again.";
  }
  return error instanceof Error ? error.message : "Unknown error";
}
