export type FetchableSourceDocument = { url: string };
export type SourceFetchMetrics = { candidateCount: number; selectedCount: number; attemptedCount: number; acceptedCount: number; failedCount: number; hostCount: number; durationMs: number };
export type SourceFetchResult<T> = { documents: Array<T | null>; metrics: SourceFetchMetrics };

function canonicalizeUrl(value: string): string | null {
  try { const url = new URL(value); if (url.protocol !== "https:") return null; url.hash = ""; return url.toString(); }
  catch { return null; }
}

/** Select a bounded, host-balanced sample so large advertiser catalogs are not all fetched each round. */
export function selectBalancedSourceUrls(urls: readonly string[], limit = 24): string[] {
  const groups = new Map<string, string[]>(); const seen = new Set<string>();
  for (const value of urls) {
    const canonical = canonicalizeUrl(value); if (!canonical || seen.has(canonical)) continue; seen.add(canonical);
    const host = new URL(canonical).hostname.toLowerCase(); const group = groups.get(host) ?? []; group.push(canonical); groups.set(host, group);
  }
  const queues = [...groups.values()]; const selected: string[] = []; let cursor = 0;
  while (selected.length < Math.max(0, limit) && queues.some((queue) => queue.length > 0)) {
    const queue = queues[cursor % queues.length]; if (queue.length > 0) selected.push(queue.shift()!); cursor += 1;
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
  const tasks: Array<Array<{ url: string; index: number }>> = [];
  for (const group of groups.values()) for (let offset = 0; offset < group.length; offset += perHostConcurrency) tasks.push(group.slice(offset, offset + perHostConcurrency));
  let nextTask = 0; let attemptedCount = 0; let acceptedCount = 0;
  const worker = async () => {
    while (nextTask < tasks.length) {
      const task = tasks[nextTask++];
      await Promise.all(task.map(async ({ url, index }) => {
        attemptedCount += 1;
        try { const document = await fetcher(url); documents[index] = document; if (document) acceptedCount += 1; }
        catch { documents[index] = null; }
      }));
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
  return { documents, metrics: { candidateCount: urls.length, selectedCount: urls.length, attemptedCount, acceptedCount, failedCount: attemptedCount - acceptedCount, hostCount: groups.size, durationMs: Date.now() - startedAt } };
}
