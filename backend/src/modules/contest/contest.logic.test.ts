import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateResponseTimeMs,
  getContestProgress,
  hasCompleteClueSequence,
  normalizeAnswer,
  REQUIRED_CLUE_COUNT,
} from "./contest.logic.js";

test("answer normalization handles whitespace, case and Arabic/Persian variants", () => {
  assert.equal(normalizeAnswer("  كِتاب   A  "), "کتاب a");
  assert.equal(normalizeAnswer("سلام\u0640"), "سلام");
});

test("only a complete ordered set of twelve clues is playable", () => {
  const expected = Array.from(
    { length: REQUIRED_CLUE_COUNT },
    (_value, index) => index + 1,
  );

  assert.equal(hasCompleteClueSequence(expected), true);
  assert.equal(hasCompleteClueSequence([...expected].reverse()), true);
  assert.equal(hasCompleteClueSequence(expected.slice(1)), false);
  assert.equal(hasCompleteClueSequence([...expected.slice(0, 11), 11]), false);
  assert.equal(hasCompleteClueSequence([...expected, 13]), false);
});

test("progress exposes only the contiguous solved prefix", () => {
  const clues = Array.from({ length: REQUIRED_CLUE_COUNT }, (_value, index) => ({
    id: "clue-" + (index + 1),
    sequence: index + 1,
  }));

  const partial = getContestProgress(
    clues,
    new Set(["clue-1", "clue-3", "clue-4"]),
  );
  assert.equal(partial.solvedCount, 1);
  assert.equal(partial.currentClue?.sequence, 2);
  assert.equal(partial.completed, false);

  const complete = getContestProgress(
    clues,
    new Set(clues.map((clue) => clue.id)),
  );
  assert.equal(complete.solvedCount, REQUIRED_CLUE_COUNT);
  assert.equal(complete.currentClue, null);
  assert.equal(complete.completed, true);
});

test("response timing starts at the latest authoritative timestamp", () => {
  const now = new Date("2026-10-18T10:01:00.000Z");
  const publishedAt = new Date("2026-10-18T10:00:30.000Z");
  const previousSolve = new Date("2026-10-18T10:00:45.000Z");

  assert.equal(
    calculateResponseTimeMs(now, [publishedAt, previousSolve]),
    15_000,
  );
  assert.equal(
    calculateResponseTimeMs(now, [publishedAt, new Date("2026-10-18T10:02:00.000Z")]),
    0,
  );
  assert.equal(calculateResponseTimeMs(now, []), 0);
});
