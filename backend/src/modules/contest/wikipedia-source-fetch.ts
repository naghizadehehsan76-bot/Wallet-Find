type WikipediaFetcherOptions = {
  fetchImpl?: typeof fetch;
  minimumSpacingMs?: number;
  wait?: (milliseconds: number) => Promise<void>;
  now?: () => number;
};

/**
 * Creates a serialized Wikimedia fetcher. A 429 is returned immediately so
 * callers can switch sources instead of holding the shared queue until retry-after.
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
          console.warn("Wikimedia rate limit received; switching to fallback source.", {
            host: url.hostname,
            status: response.status,
            retryAfter: response.headers.get("retry-after"),
          });
          return response;
        }
        if (response.status < 500 || attempt === 2) return response;

        const retryDelay = 1_000 * (attempt + 1);
        console.warn("Wikimedia server error; retrying after a short delay.", {
          host: url.hostname,
          status: response.status,
          retryDelay,
        });
        await wait(retryDelay);
      }
      throw new Error("WIKIPEDIA_REQUEST_RETRIES_EXHAUSTED");
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
