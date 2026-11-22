export type FetchableSourceDocument = { url: string };
export type SourceFetchMetrics = { candidateCount: number; selectedCount: number; attemptedCount: number; acceptedCount: number; failedCount: number; hostCount: number; durationMs: number };
export type SourceFetchResult<T> = { documents: Array<T | null>; metrics: SourceFetchMetrics };

function canonicalizeUrl(value: string): string | null {
  try { const url = new URL(value); if (url.protocol !== "https:") return null; url.hash = ""; return url.toString(); }
  catch { return null; }
}

/** Select a bounded, host-balanced sample so large advertiser catalogs are not all fetched each round. */
export function selectBalancedSourceUrls(urls: readonly string[], limit = 24, rotationOffset = 0): string[] {
  const groups = new Map<string, string[]>(); const seen = new Set<string>();
  for (const value of urls) {
    const canonical = canonicalizeUrl(value); if (!canonical || seen.has(canonical)) continue; seen.add(canonical);
    const host = new URL(canonical).hostname.toLowerCase(); const group = groups.get(host) ?? []; group.push(canonical); groups.set(host, group);
  }
  const offset = Math.abs(Math.floor(rotationOffset));
  const queues = [...groups.values()].map((group) => {
    const shift = group.length > 0 ? offset % group.length : 0;
    return [...group.slice(shift), ...group.slice(0, shift)];
  });
  const selected: string[] = []; let cursor = queues.length > 0 ? offset % queues.length : 0;
  while (selected.length < Math.max(0, limit) && queues.some((queue) => queue.length > 0)) {
    const queue = queues[cursor % queues.length];
    if (queue && queue.length > 0) selected.push(queue.shift()!);
    cursor += 1;
  }
  return selected;
}

/** Fetch with bounded global/per-host concurrency and stable result ordering. */
export async function fetchSourceDocuments<T extends FetchableSourceDocument>(
  urls: readonly string[], fetcher: (url: string) => Promise<T | null>,
  options: { concurrency?: number; perHostConcurrency?: number } = {},
): Promise<SourceFetchResult<T>> {
  const startedAt = Date.now(); const concurrency = Math.max(1, Math.floor(options.concurrency ?? 6));
  const perHostConcurrency = Math.max(1, Math.floor(options.perHostConcurrency ?? 2));
  const documents: Array<T | null> = Array.from({ length: urls.length }, () => null);
  const groups = new Map<string, Array<{ url: string; index: number }>>();
  urls.forEach((url, index) => {
    const canonical = canonicalizeUrl(url); if (!canonical) return;
    const host = new URL(canonical).hostname.toLowerCase(); const group = groups.get(host) ?? [];
    group.push({ url: canonical, index }); groups.set(host, group);
  });
  const pending: Array<{ url: string; index: number; host: string }> = [];
  for (const [host, group] of groups) {
    for (const item of group) pending.push({ ...item, host });
  }
  let attemptedCount = 0;
  let acceptedCount = 0;
  let activeCount = 0;
  const activeByHost = new Map<string, number>();

  await new Promise<void>((resolve) => {
    const pump = () => {
      while (activeCount < concurrency) {
        const nextIndex = pending.findIndex((item) =>
          (activeByHost.get(item.host) ?? 0) < perHostConcurrency
        );
        if (nextIndex < 0) break;
        const [item] = pending.splice(nextIndex, 1);
        if (!item) continue;
        activeCount += 1;
        attemptedCount += 1;
        activeByHost.set(item.host, (activeByHost.get(item.host) ?? 0) + 1);

        void fetcher(item.url)
          .then((document) => {
            documents[item.index] = document;
            if (document) acceptedCount += 1;
          })
          .catch(() => {
            documents[item.index] = null;
          })
          .finally(() => {
            activeCount -= 1;
            const hostActive = (activeByHost.get(item.host) ?? 1) - 1;
            if (hostActive > 0) activeByHost.set(item.host, hostActive);
            else activeByHost.delete(item.host);
            if (pending.length === 0 && activeCount === 0) {
              resolve();
              return;
            }
            pump();
          });
      }
      if (pending.length === 0 && activeCount === 0) resolve();
    };
    pump();
  });
  return { documents, metrics: { candidateCount: urls.length, selectedCount: urls.length, attemptedCount, acceptedCount, failedCount: attemptedCount - acceptedCount, hostCount: groups.size, durationMs: Date.now() - startedAt } };
}

export async function readBoundedResponseText(response: Response, maxBytes: number): Promise<string | null> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) return null;
  if (!response.body) return null;

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let totalBytes = 0;
  let text = "";
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        return null;
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
    return text;
  } finally {
    reader.releaseLock();
  }
}
