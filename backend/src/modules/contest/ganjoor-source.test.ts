import assert from "node:assert/strict";
import test from "node:test";

import { createGanjoorRandomPoemFetcher } from "./ganjoor-source.js";

test("Ganjoor retries the alternate official host after a 404", async () => {
  const requestedHosts: string[] = [];
  const fetchRandomPoem = createGanjoorRandomPoemFetcher({
    wait: async () => undefined,
    fetchImpl: async (input) => {
      const url = new URL(String(input));
      requestedHosts.push(url.hostname);
      if (url.hostname === "ganjgah.ir") return new Response("not found", { status: 404 });
      return new Response(JSON.stringify({ plainText: "متن شعر", published: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  });

  const response = await fetchRandomPoem(2);
  assert.equal(response?.status, 200);
  assert.deepEqual(requestedHosts, ["ganjgah.ir", "api.ganjoor.net"]);
});

test("Ganjoor does not call the fallback host when the preferred host succeeds", async () => {
  const requestedHosts: string[] = [];
  const fetchRandomPoem = createGanjoorRandomPoemFetcher({
    wait: async () => undefined,
    fetchImpl: async (input) => {
      requestedHosts.push(new URL(String(input)).hostname);
      return new Response(JSON.stringify({ plainText: "متن شعر", published: true }), { status: 200 });
    },
  });

  const response = await fetchRandomPoem(7);
  assert.equal(response?.status, 200);
  assert.deepEqual(requestedHosts, ["ganjgah.ir"]);
});

test("Ganjoor retries a rate-limited host once before failing over", async () => {
  const requestedHosts: string[] = [];
  const delays: number[] = [];
  let preferredHostAttempts = 0;
  const fetchRandomPoem = createGanjoorRandomPoemFetcher({
    wait: async (milliseconds) => { delays.push(milliseconds); },
    fetchImpl: async (input) => {
      const host = new URL(String(input)).hostname;
      requestedHosts.push(host);
      if (host === "ganjgah.ir") {
        preferredHostAttempts += 1;
        return new Response("rate limited", {
          status: 429,
          headers: { "retry-after": "1" },
        });
      }
      return new Response("not found", { status: 404 });
    },
  });

  const response = await fetchRandomPoem(5);
  assert.equal(response?.status, 404);
  assert.equal(preferredHostAttempts, 2);
  assert.deepEqual(requestedHosts, ["ganjgah.ir", "ganjgah.ir", "api.ganjoor.net"]);
  assert.ok(delays.includes(1_000));
});
