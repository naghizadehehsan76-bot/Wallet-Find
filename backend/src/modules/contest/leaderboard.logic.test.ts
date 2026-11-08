import test from "node:test";
import assert from "node:assert/strict";
import { buildLeaderboardEntries, type LeaderboardAggregateRow } from "./leaderboard.logic.js";

const start = new Date("2026-11-08T12:00:00.000Z");

function row(
  userId: string,
  solvedCount: number,
  incorrectAttempts: number,
  completedAt: string | null,
  lastSubmittedAt: string | null,
): LeaderboardAggregateRow {
  return {
    userId,
    username: userId,
    solvedCount,
    incorrectAttempts,
    completedAt: completedAt ? new Date(completedAt) : null,
    lastSubmittedAt: lastSubmittedAt ? new Date(lastSubmittedAt) : null,
  };
}

test("preserves completed-first database order and gives equal finish times equal ranks", () => {
  const entries = buildLeaderboardEntries([
    row("fast", 12, 4, "2026-11-08T12:00:10.000Z", "2026-11-08T12:00:10.000Z"),
    row("tie", 12, 0, "2026-11-08T12:00:10.000Z", "2026-11-08T12:00:10.000Z"),
    row("partial", 8, 1, null, "2026-11-08T12:04:00.000Z"),
  ], start);

  assert.deepEqual(entries.map((entry) => [entry.userId, entry.rank, entry.completed]), [
    ["fast", 1, true],
    ["tie", 1, true],
    ["partial", 3, false],
  ]);
  assert.equal(entries[0]?.totalResponseTimeMs, 10_000);
  assert.equal(entries[1]?.totalResponseTimeMs, 10_000);
});

test("incomplete participants use last server submission time and handle missing start time", () => {
  const withStart = buildLeaderboardEntries([
    row("later", 3, 0, null, "2026-11-08T12:01:00.000Z"),
    row("earlier", 3, 2, null, "2026-11-08T12:00:30.000Z"),
  ], start);
  assert.equal(withStart[0]?.totalResponseTimeMs, 30_000);
  assert.equal(withStart[1]?.totalResponseTimeMs, 60_000);

  const withoutStart = buildLeaderboardEntries([
    row("legacy", 12, 0, "2026-11-08T12:01:00.000Z", null),
  ], null);
  assert.equal(withoutStart[0]?.totalResponseTimeMs, 0);
});
