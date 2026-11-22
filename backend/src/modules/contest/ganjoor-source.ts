type GanjoorFetcherOptions = {
  fetchImpl?: typeof fetch;
  wait?: (milliseconds: number) => Promise<void>;
  baseUrls?: readonly string[];
};

const DEFAULT_BASE_URLS = ["https://ganjgah.ir", "https://api.ganjoor.net"] as const;

/**
 * Ganjoor publishes the same read API through both hosts. Prefer the currently
 * documented ganjgah.ir host, then fall back to api.ganjoor.net when a host is
 * unavailable or its route returns 404.
 */
export function createGanjoorRandomPoemFetcher(options: GanjoorFetcherOptions = {}) {
  const fetchImpl = options.fetchImpl ?? fetch;
  const wait = options.wait ?? ((milliseconds: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, milliseconds)));
  const baseUrls = options.baseUrls ?? DEFAULT_BASE_URLS;
  let requestCount = 0;

  return async function fetchRandomPoemForPoet(poetId: number): Promise<Response | null> {
    for (const baseUrl of baseUrls) {
      const url = new URL("/api/ganjoor/poem/random", baseUrl);
      url.searchParams.set("poetId", String(poetId));
      let response: Response | null = null;

      for (let attempt = 0; attempt < 2; attempt += 1) {
        if (requestCount > 0) await wait(1_500);
        requestCount += 1;

        try {
          response = await fetchImpl(url, {
            headers: {
              Accept: "application/json",
              "User-Agent": "WalletFind/1.0 (Persian public-domain clue source; https://wallet-find.com)",
            },
            signal: AbortSignal.timeout(10_000),
          });
        } catch {
          response = null;
          break;
        }

        if (response.status === 429 && attempt === 0) {
          const retryAfter = Number(response.headers.get("retry-after"));
          const retryDelay = Number.isFinite(retryAfter) && retryAfter > 0
            ? Math.min(30_000, retryAfter * 1_000)
            : 5_000;
          await wait(retryDelay);
          continue;
        }

        if (response.ok) return response;
        if (response.status === 404 || response.status >= 500 || response.status === 429) {
          break;
        }
        return response;
      }
    }

    return null;
  };
}

export const fetchGanjoorRandomPoem = createGanjoorRandomPoemFetcher();
