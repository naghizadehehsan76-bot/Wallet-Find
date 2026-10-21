import assert from "node:assert/strict";
import test from "node:test";

import {
  calculateCluePublicationTime,
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

test("all participants share the same global clue publication schedule", () => {
  const contestStartsAt = new Date("2026-10-21T10:00:00.000Z");

  assert.equal(
    calculateCluePublicationTime(1, contestStartsAt, 2)?.toISOString(),
    "2026-10-21T10:00:00.000Z",
  );
  assert.equal(
    calculateCluePublicationTime(2, contestStartsAt, 2)?.toISOString(),
    "2026-10-21T10:02:00.000Z",
  );
  assert.equal(
    calculateCluePublicationTime(12, contestStartsAt, 2)?.toISOString(),
    "2026-10-21T10:22:00.000Z",
  );
  assert.equal(calculateCluePublicationTime(2, null, 2), null);
});

test("response time is measured from publication to submission, not from the previous answer", () => {
  const publishedAt = new Date("2026-10-21T10:02:00.000Z");
  const correctSubmittedAt = new Date("2026-10-21T10:05:30.250Z");

  assert.equal(
    calculateResponseTimeMs(correctSubmittedAt, [publishedAt]),
    210_250,
  );
});

test("contest finish time includes the scheduled waiting time between clues", () => {
  const firstCluePublishedAt = new Date("2026-10-21T10:00:00.000Z");
  const finalAnswerSubmittedAt = new Date("2026-10-21T10:22:10.000Z");

  assert.equal(
    calculateResponseTimeMs(finalAnswerSubmittedAt, [firstCluePublishedAt]),
    1_330_000,
  );
});

test("response time never becomes negative", () => {
  const now = new Date("2026-10-21T10:01:00.000Z");
  const futurePublication = new Date("2026-10-21T10:02:00.000Z");

  assert.equal(calculateResponseTimeMs(now, [futurePublication]), 0);
  assert.equal(calculateResponseTimeMs(now, []), 0);
});
