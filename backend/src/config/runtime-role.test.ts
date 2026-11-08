import test from "node:test";
import assert from "node:assert/strict";
import {
  getRuntimeRole,
  shouldStartBackgroundWorkers,
  shouldStartHttpServer,
} from "./runtime-role.js";

test("keeps current deployments backwards compatible with the all-in-one role", () => {
  assert.equal(getRuntimeRole(undefined), "all");
  assert.equal(shouldStartHttpServer("all"), true);
  assert.equal(shouldStartBackgroundWorkers("all"), true);
});

test("supports API-only and Worker-only process roles", () => {
  assert.equal(getRuntimeRole("web"), "web");
  assert.equal(shouldStartHttpServer("web"), true);
  assert.equal(shouldStartBackgroundWorkers("web"), false);

  assert.equal(getRuntimeRole("worker"), "worker");
  assert.equal(shouldStartHttpServer("worker"), false);
  assert.equal(shouldStartBackgroundWorkers("worker"), true);
});

test("rejects unknown role values instead of silently starting the wrong process", () => {
  assert.throws(() => getRuntimeRole("api"), /APP_ROLE/);
});
