import test from "node:test";
import assert from "node:assert/strict";
import { calculatePrizeAllocations } from "./prize-distribution.js";

const USDT = 1_000_000n;

test("allocates 50/25/12.5 to ranks one through three and weights the final 12.5 across rank four+", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "b", rank: 2, elapsedMs: 20_000 },
    { userId: "c", rank: 3, elapsedMs: 30_000 },
    { userId: "d", rank: 4, elapsedMs: 40_000 },
    { userId: "e", rank: 5, elapsedMs: 80_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("a"), 500_000n);
  assert.equal(amounts.get("b"), 250_000n);
  assert.equal(amounts.get("c"), 125_000n);
  assert.equal(amounts.get("d")! + amounts.get("e")!, 125_000n);
  assert.ok(amounts.get("d")! > amounts.get("e")!, "faster rank-four finisher gets more");
  assert.equal(amounts.get("e")! > 0n, true);
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), USDT);
});

test("splits inverse-time tail equally when rank-four-and-below finishers have exact time ties", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "b", rank: 2, elapsedMs: 20_000 },
    { userId: "c", rank: 3, elapsedMs: 30_000 },
    { userId: "d", rank: 4, elapsedMs: 40_000 },
    { userId: "e", rank: 5, elapsedMs: 40_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("d"), 62_500n);
  assert.equal(amounts.get("e"), 62_500n);
});

test("does not redistribute missing podium shares; only the 12.5 percent tail is shared below rank three", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "d", rank: 4, elapsedMs: 40_000 },
    { userId: "e", rank: 5, elapsedMs: 80_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("a"), 500_000n);
  assert.equal(amounts.get("d")! + amounts.get("e")!, 125_000n);
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), 625_000n);
});

test("a single rank-four-or-lower finisher receives the full 12.5 percent tail", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "d", rank: 4, elapsedMs: 40_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("d"), 125_000n);
});

test("returns no awards for an empty or zero-value pool", () => {
  assert.deepEqual(calculatePrizeAllocations(0n, [{ userId: "a", rank: 1, elapsedMs: 1 }]), []);
  assert.deepEqual(calculatePrizeAllocations(USDT, []), []);
});


test("uses the fixed 0.1 USDT0 basis without requiring a full 0.1 debit when some rank shares are unused", () => {
  const awards = calculatePrizeAllocations(100_000n, [
    { userId: "winner", rank: 1, elapsedMs: 10_000 },
  ]);
  assert.deepEqual(awards, [{ userId: "winner", rank: 1, amountMicro: 50_000n }]);
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), 50_000n);
});


test("a tie for first place splits only the fixed first-place 50% share", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "b", rank: 1, elapsedMs: 10_000 },
    { userId: "c", rank: 3, elapsedMs: 20_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("a"), 250_000n);
  assert.equal(amounts.get("b"), 250_000n);
  assert.equal(amounts.get("c"), 125_000n);
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), 625_000n);
});

test("a tie for second place splits only the fixed second-place 25% share", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "b", rank: 2, elapsedMs: 20_000 },
    { userId: "c", rank: 2, elapsedMs: 20_000 },
    { userId: "d", rank: 4, elapsedMs: 30_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("a"), 500_000n);
  assert.equal(amounts.get("b"), 125_000n);
  assert.equal(amounts.get("c"), 125_000n);
  assert.equal(amounts.get("d"), 125_000n);
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), 875_000n);
});

test("a tie for third place splits only the fixed third-place 12.5% share", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "b", rank: 2, elapsedMs: 20_000 },
    { userId: "c", rank: 3, elapsedMs: 30_000 },
    { userId: "d", rank: 3, elapsedMs: 30_000 },
    { userId: "e", rank: 5, elapsedMs: 40_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("a"), 500_000n);
  assert.equal(amounts.get("b"), 250_000n);
  assert.equal(amounts.get("c"), 62_500n);
  assert.equal(amounts.get("d"), 62_500n);
  assert.equal(amounts.get("e"), 125_000n);
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), USDT);
});
