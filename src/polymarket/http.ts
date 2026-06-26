import type { ILogger } from "../logger/types.js";

export class PublicApiError extends Error {
  constructor(
    message: string,
    readonly context: {
      url: string;
      status?: number;
      attempt?: number;
      body?: string;
    },
  ) {
    super(message);
    this.name = "PublicApiError";
  }
}

export interface HttpClientOptions {
  timeoutMs?: number;
  maxRetries?: number;
  minIntervalMs?: number;
  baseBackoffMs?: number;
}

export interface HttpClient {
  fetchJson<T>(url: string, init?: RequestInit): Promise<T>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  if (!Number.isNaN(seconds)) {
    return seconds * 1000;
  }
  const date = Date.parse(header);
  if (!Number.isNaN(date)) {
    return Math.max(0, date - Date.now());
  }
  return null;
}

function isRetryableStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function jitter(ms: number): number {
  return ms + Math.floor(Math.random() * ms * 0.25);
}

export function createHttpClient(
  logger: ILogger,
  options: HttpClientOptions = {},
): HttpClient {
  const timeoutMs = options.timeoutMs ?? 15_000;
  const maxRetries = options.maxRetries ?? 3;
  const minIntervalMs = options.minIntervalMs ?? 100;
  const baseBackoffMs = options.baseBackoffMs ?? 500;

  let queue: Promise<void> = Promise.resolve();
  let lastRequestAt = 0;

  const scheduleRequest = async <T>(fn: () => Promise<T>): Promise<T> => {
    const run = async () => {
      const elapsed = Date.now() - lastRequestAt;
      if (elapsed < minIntervalMs) {
        await sleep(minIntervalMs - elapsed);
      }
      lastRequestAt = Date.now();
      return fn();
    };

    const result = queue.then(run, run);
    queue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  };

  const fetchJson = async <T>(url: string, init?: RequestInit): Promise<T> => {
    return scheduleRequest(async () => {
      let lastError: unknown;

      for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
          const response = await fetch(url, {
            ...init,
            signal: AbortSignal.timeout(timeoutMs),
            headers: {
              Accept: "application/json",
              ...init?.headers,
            },
          });

          if (!response.ok) {
            const body = await response.text();
            if (isRetryableStatus(response.status) && attempt < maxRetries) {
              const retryAfter =
                parseRetryAfter(response.headers.get("Retry-After")) ??
                jitter(baseBackoffMs * 2 ** (attempt - 1));
              logger.warn(
                {
                  url,
                  status: response.status,
                  attempt,
                  retryAfterMs: retryAfter,
                },
                "Polymarket API request failed, retrying",
              );
              await sleep(retryAfter);
              continue;
            }

            logger.error(
              { url, status: response.status, attempt, body },
              "Polymarket API request failed",
            );
            throw new PublicApiError(
              `Request failed with status ${response.status}`,
              { url, status: response.status, attempt, body },
            );
          }

          return (await response.json()) as T;
        } catch (error) {
          lastError = error;
          if (error instanceof PublicApiError) {
            throw error;
          }

          if (attempt < maxRetries) {
            const retryAfter = jitter(baseBackoffMs * 2 ** (attempt - 1));
            logger.warn(
              { url, attempt, err: String(error), retryAfterMs: retryAfter },
              "Polymarket API network error, retrying",
            );
            await sleep(retryAfter);
            continue;
          }

          logger.error(
            { url, attempt, err: String(error) },
            "Polymarket API network error",
          );
          throw new PublicApiError(
            error instanceof Error ? error.message : "Network request failed",
            { url, attempt },
          );
        }
      }

      throw lastError instanceof Error
        ? lastError
        : new PublicApiError("Request failed after retries", { url });
    });
  };

  return { fetchJson };
}
