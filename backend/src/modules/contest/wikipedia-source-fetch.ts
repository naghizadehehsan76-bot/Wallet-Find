type WikipediaFetcherOptions = {
  fetchImpl?: typeof fetch;
  minimumSpacingMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

/** Parse Retry-After as seconds or an HTTP date. */
function getRetryAfterMs(response: Response, now: number): number | null {
  const value = response.headers.get("retry-after");
  if (!value) return null;
  const seconds = Number(value);
  if (Number.isFinite(seconds) && seconds >= 0) return Math.ceil(seconds * 1_000);
  const date = Date.parse(value);
  return Number.isFinite(date) ? Math.max(0, date - now) : null;
}

/**
 * One process-wide serialized Wikimedia queue. It spaces requests, retries
 * transient failures, and honors Retry-After without creating parallel bursts.
 */
export function createWikipediaResponseFetcher(options: WikipediaFetcherOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const minimumSpacingMs = options.minimumSpacingMs ?? 1_500;
  const wait = options.wait ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const now = options.now ?? Date.now;
  let queue: Promise<void> = Promise.resolve();
  let lastRequestAt = 0;

  return async function fetchWikipediaResponse(
    url: URL,
    headers: Record<string, string>,
    timeoutMs: number,
  ): Promise<Response> {
    const request = queue.then(async () => {
      for (let attempt = 0; attempt < 3; attempt += 1) {
        const spacing = Math.max(0, minimumSpacingMs - (now() - lastRequestAt));
        if (spacing > 0) await wait(spacing);
        lastRequestAt = now();

        const response = await fetchImpl(url, {
          headers,
          signal: AbortSignal.timeout(timeoutMs),
        });
        if (response.status === 429) {
          const retryAfterMs = getRetryAfterMs(response, now());
          if (attempt === 2 || (retryAfterMs !== null && retryAfterMs > 60_000)) {
            console.warn("Wikimedia rate limit received; using fallback source.", {
              host: url.hostname, status: response.status, retryAfterMs,
            });
            return response;
          }
          const retryDelay = retryAfterMs ?? 2_000 * (attempt + 1);
          console.warn("Wikimedia rate limit received; retrying after the requested delay.", {
            host: url.hostname, status: response.status, retryDelay,
          });
          await wait(Math.max(1_000, retryDelay));
          continue;
        }
        if (response.status < 500 || attempt === 2) return response;

        const retryDelay = 1_000 * (attempt + 1);
        console.warn("Wikimedia server error; retrying after a short delay.", {
          host: url.hostname, status: response.status, retryDelay,
        });
        await wait(retryDelay);
      }
      throw new Error("WIKIMEDIA_REQUEST_RETRIES_EXHAUSTED");
    });

    queue = request.then(() => undefined, () => undefined);
    return request;
  };
}

/** Returns fallback documents only when the primary source has too few usable pages. */
export async function loadFallbackWhenInsufficient<T>(
  primaryDocuments: readonly T[],
  loadFallback: () => Promise<T[]>,
  minimumPrimaryDocuments = 3,
): Promise<T[]> {
  return primaryDocuments.length < minimumPrimaryDocuments ? loadFallback() : [];
}
