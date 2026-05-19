// STRATZ GraphQL client. Single endpoint, JWT bearer auth, timeout + retries.
// Used only at build time by scripts/prefetch.ts.

import { ApiError, UserError } from "./errors";

export const STRATZ_ENDPOINT = "https://api.stratz.com/graphql";
const DEFAULT_TIMEOUT_MS = 30000;
const DEFAULT_RETRIES = 2;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);

export interface StratzError {
  message: string;
  path?: (string | number)[];
  extensions?: Record<string, unknown>;
}

export interface StratzQueryOptions {
  timeoutMs?: number;
  retries?: number;
  operationName?: string;
}

export interface StratzClient {
  query<T>(query: string, variables?: Record<string, unknown>, opts?: StratzQueryOptions): Promise<T>;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export function createStratzClient(token: string, version = "0.3.0"): StratzClient {
  if (!token) {
    throw new UserError("STRATZ_TOKEN env var is missing. Get a JWT at https://stratz.com/api and put it in .env.local.");
  }

  async function query<T>(
    gql: string,
    variables?: Record<string, unknown>,
    opts: StratzQueryOptions = {},
  ): Promise<T> {
    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const retries = opts.retries ?? DEFAULT_RETRIES;
    const body = JSON.stringify({ query: gql, variables });
    const opName = opts.operationName ?? "(anon)";

    let attempt = 0;
    let lastErr: unknown;
    while (attempt <= retries) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), timeoutMs);
      try {
        const res = await fetch(STRATZ_ENDPOINT, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Bearer ${token}`,
            "User-Agent": "STRATZ_API",
            "Accept-Encoding": "gzip, deflate",
          },
          body,
          signal: ctrl.signal,
        });

        if (!res.ok) {
          const text = await res.text();
          if (res.status === 401 || res.status === 403) {
            throw new UserError(
              `STRATZ rejected the token (HTTP ${res.status}). Get a fresh one at https://stratz.com/api.`,
            );
          }
          if (RETRYABLE_STATUSES.has(res.status) && attempt < retries) {
            attempt++;
            await sleep(2 ** attempt * 300);
            continue;
          }
          throw new ApiError(
            `STRATZ HTTP ${res.status} ${res.statusText} on ${opName}: ${text.slice(0, 240)}`,
            res.status,
            "http_error",
            text,
            STRATZ_ENDPOINT,
          );
        }

        const json = (await res.json()) as { data?: T; errors?: StratzError[] };
        if (json.errors && json.errors.length) {
          const msg = json.errors.map((e) => e.message).join("; ");
          throw new ApiError(
            `STRATZ GraphQL error on ${opName}: ${msg}`,
            res.status,
            "graphql_error",
            json.errors,
            STRATZ_ENDPOINT,
          );
        }
        if (!json.data) {
          throw new ApiError("STRATZ returned no data field", res.status, "empty_response", json, STRATZ_ENDPOINT);
        }
        return json.data;
      } catch (err: unknown) {
        if (err instanceof UserError) throw err;
        if (err instanceof ApiError) throw err;
        lastErr = err;
        const e = err as { name?: string; message?: string };
        const isAbort = e?.name === "AbortError";
        if (attempt < retries) {
          attempt++;
          await sleep(2 ** attempt * 300);
          continue;
        }
        throw new ApiError(
          isAbort ? `STRATZ request timed out after ${timeoutMs}ms` : `STRATZ network error: ${e?.message ?? String(err)}`,
          0,
          isAbort ? "timeout" : "network_error",
          undefined,
          STRATZ_ENDPOINT,
        );
      } finally {
        clearTimeout(t);
      }
    }
    throw lastErr;
  }

  return { query };
}
