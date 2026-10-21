import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateClueAvailableAt,
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

test("the first clue unlocks at contest start and later clues unlock two minutes after a correct answer", () => {
  const contestStartsAt = new Date("2026-10-21T10:00:00.000Z");
  const previousCorrectSubmittedAt = new Date("2026-10-21T10:03:30.000Z");

  assert.equal(
    calculateClueAvailableAt(1, contestStartsAt, null, 2)?.toISOString(),
    contestStartsAt.toISOString(),
  );
  assert.equal(
    calculateClueAvailableAt(2, contestStartsAt, previousCorrectSubmittedAt, 2)?.toISOString(),
    "2026-10-21T10:05:30.000Z",
  );
  assert.equal(
    calculateClueAvailableAt(3, contestStartsAt, null, 2),
    null,
  );
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
