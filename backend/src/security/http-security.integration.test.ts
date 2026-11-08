import assert from "node:assert/strict";
import { after, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import app from "../app.js";

let server: Server;
let baseUrl: string;

before(async () => {
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_UNAVAILABLE");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

after(async () => {
  if (server) await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
});

async function preflight(origin: string): Promise<Response> {
  return fetch(`${baseUrl}/api/stats/site`, {
    method: "OPTIONS",
    headers: {
      Origin: origin,
      "Access-Control-Request-Method": "GET",
      "Access-Control-Request-Headers": "authorization,content-type",
    },
  });
}

test("CORS allows the first-party production origin", async () => {
  const response = await preflight("https://wallet-find.com");
  assert.equal(response.headers.get("access-control-allow-origin"), "https://wallet-find.com");
  assert.equal(response.headers.get("access-control-allow-credentials"), "true");
});

test("CORS does not reflect an arbitrary attacker-controlled origin", async () => {
  const response = await preflight("https://attacker.example");
  assert.equal(response.headers.get("access-control-allow-origin"), null);
});

test("admin and wallet APIs reject unauthenticated access", async () => {
  const admin = await fetch(`${baseUrl}/api/admin/overview`);
  const wallet = await fetch(`${baseUrl}/api/wallet/me`);
  assert.equal(admin.status, 401);
  assert.equal(wallet.status, 401);
});

test("SQL-injection-shaped identifiers cannot bypass admin authentication", async () => {
  const response = await fetch(`${baseUrl}/api/admin/contest-settings/%27%20OR%20%271%27%3D%271`);
  assert.equal(response.status, 401);
});
