import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateResponseTimeMs,
  getContestProgress,
  hasCompleteClueSequence,
  normalizeAnswer,
  REQUIRED_CLUE_COUNT,
  CONTEST_DURATION_MS,
  WRONG_ANSWER_LOCK_MS,
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

test("contest duration is fifteen minutes and wrong answers lock for two minutes", () => {
  assert.equal(CONTEST_DURATION_MS, 900_000);
  assert.equal(WRONG_ANSWER_LOCK_MS, 120_000);
});

test("response time is measured from the shared contest start", () => {
  const contestStartsAt = new Date("2026-10-21T10:00:00.000Z");
  const correctSubmittedAt = new Date("2026-10-21T10:05:30.250Z");

  assert.equal(
    calculateResponseTimeMs(correctSubmittedAt, [contestStartsAt]),
    330_250,
  );
});

test("contest finish time is measured from the shared round start", () => {
  const contestStartsAt = new Date("2026-10-21T10:00:00.000Z");
  const finalAnswerSubmittedAt = new Date("2026-10-21T10:14:10.000Z");

  assert.equal(
    calculateResponseTimeMs(finalAnswerSubmittedAt, [contestStartsAt]),
    850_000,
  );
});

test("response time never becomes negative", () => {
  const now = new Date("2026-10-21T10:01:00.000Z");
  const futureStart = new Date("2026-10-21T10:02:00.000Z");

  assert.equal(calculateResponseTimeMs(now, [futureStart]), 0);
  assert.equal(calculateResponseTimeMs(now, []), 0);
});
