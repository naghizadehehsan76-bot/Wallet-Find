import test from "node:test";
import assert from "node:assert/strict";
import { normalizeAnswer } from "../src/modules/contest/contest.service.js";

test("normalizeAnswer trims surrounding whitespace", () => {
  assert.equal(normalizeAnswer("  Apple  "), "apple");
});

test("normalizeAnswer collapses repeated whitespace", () => {
  assert.equal(normalizeAnswer("Moon   Light\n"), "moon light");
});

test("normalizeAnswer lowercases answers", () => {
  assert.equal(normalizeAnswer("BiTcOiN"), "bitcoin");
});
