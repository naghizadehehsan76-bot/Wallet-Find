import assert from "node:assert/strict";
import test from "node:test";

import {
  createWikipediaResponseFetcher,
  loadFallbackWhenInsufficient,
} from "./wikipedia-source-fetch.js";

const url = new URL("https://en.wikipedia.org/w/api.php");
const headers = { "User-Agent": "WalletFind test" };

test("HTTP 429 is returned immediately so the caller can use its independent fallback", async () => {
  let requests = 0;
  let fallbackRequests = 0;
  const fetchWikipediaResponse = createWikipediaResponseFetcher({
    minimumSpacingMs: 0,
    fetchImpl: async () => {
      requests += 1;
      return new Response("rate limited", {
        status: 429,
        headers: { "retry-after": "60" },
      });
    },
  });

  const response = await fetchWikipediaResponse(url, headers, 1_000);
  assert.equal(response.status, 429);
  assert.equal(requests, 1, "429 must not be retried or wait for Retry-After");

  const primaryDocuments = response.ok ? ["unexpected primary document"] : [];
  const fallbackDocuments = await loadFallbackWhenInsufficient(
    primaryDocuments,
    async () => {
      fallbackRequests += 1;
      return ["language-matched fallback document"];
    },
    3,
  );

  assert.equal(fallbackRequests, 1);
  assert.deepEqual(fallbackDocuments, ["language-matched fallback document"]);
});

test("a usable primary source avoids unnecessary fallback requests", async () => {
  let fallbackRequests = 0;
  const documents = await loadFallbackWhenInsufficient(
    ["one", "two", "three"],
    async () => {
      fallbackRequests += 1;
      return ["fallback"];
    },
    3,
  );

  assert.deepEqual(documents, []);
  assert.equal(fallbackRequests, 0);
});

test("transient Wikimedia 5xx responses receive short retries", async () => {
  let requests = 0;
  const delays: number[] = [];
  const fetchWikipediaResponse = createWikipediaResponseFetcher({
    minimumSpacingMs: 0,
    wait: async (milliseconds) => { delays.push(milliseconds); },
    fetchImpl: async () => {
      requests += 1;
      return requests < 3
        ? new Response("temporary error", { status: 503 })
        : new Response("ok", { status: 200 });
    },
  });

  const response = await fetchWikipediaResponse(url, headers, 1_000);
  assert.equal(response.status, 200);
  assert.equal(requests, 3);
  assert.deepEqual(delays, [1_000, 2_000]);
});
