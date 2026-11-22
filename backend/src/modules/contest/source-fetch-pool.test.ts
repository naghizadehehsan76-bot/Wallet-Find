import assert from "node:assert/strict";
import test from "node:test";
import { fetchSourceDocuments, selectBalancedSourceUrls } from "./source-fetch-pool.js";

test("source selection deduplicates and balances across advertiser hosts", () => {
  const selected = selectBalancedSourceUrls(["https://advertiser-a.example/page-1#top", "https://advertiser-a.example/page-2", "https://advertiser-a.example/page-3", "https://advertiser-b.example/landing", "https://advertiser-c.example/offer", "https://advertiser-a.example/page-1", "http://insecure.example/page"], 4);
  assert.deepEqual(selected, ["https://advertiser-a.example/page-1", "https://advertiser-b.example/landing", "https://advertiser-c.example/offer", "https://advertiser-a.example/page-2"]);
});

test("source selection is bounded for a large source catalog", () => {
  const urls = Array.from({ length: 500 }, (_, index) => `https://advertiser-${index % 25}.example/page-${index}`);
  const selected = selectBalancedSourceUrls(urls, 24);
  assert.equal(selected.length, 24); assert.equal(new Set(selected.map((url) => new URL(url).hostname)).size, 24);
});

test("fetches are bounded per host and preserve configured order", async () => {
  let active = 0; let maximumActive = 0;
  const urls = ["https://same.example/1", "https://same.example/2", "https://same.example/3", "https://other.example/1", "https://other.example/2", "https://third.example/1"];
  const result = await fetchSourceDocuments(urls, async (url) => {
    active += 1; maximumActive = Math.max(maximumActive, active);
    await new Promise((resolve) => setTimeout(resolve, 5)); active -= 1;
    return { url, text: url };
  }, { concurrency: 3, perHostConcurrency: 1 });
  assert.equal(maximumActive, 3); assert.deepEqual(result.documents.map((item) => item?.url), urls);
  assert.equal(result.metrics.attemptedCount, urls.length); assert.equal(result.metrics.acceptedCount, urls.length); assert.equal(result.metrics.hostCount, 3);
});

test("failed pages are counted without aborting other pages", async () => {
  const result = await fetchSourceDocuments(["https://one.example/a", "https://two.example/b"], async (url) => url.includes("/a") ? null : { url }, { concurrency: 2 });
  assert.equal(result.metrics.acceptedCount, 1); assert.equal(result.metrics.failedCount, 1);
  assert.equal(result.documents[0], null); assert.equal(result.documents[1]?.url, "https://two.example/b");
});
