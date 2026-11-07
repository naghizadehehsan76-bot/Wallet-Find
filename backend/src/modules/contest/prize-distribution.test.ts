import test from "node:test";
import assert from "node:assert/strict";
import { calculatePrizeAllocations } from "./prize-distribution.js";

const USDT = 1_000_000n;

test("allocates the podium 50/20/10 and leaves unfilled 4+ share unused", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "b", rank: 2, elapsedMs: 20_000 },
    { userId: "c", rank: 3, elapsedMs: 30_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("a"), 500_000n);
  assert.equal(amounts.get("b"), 200_000n);
  assert.equal(amounts.get("c"), 100_000n);
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), 800_000n);
});

test("splits occupied podium slots equally for an exact first-place tie", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "b", rank: 1, elapsedMs: 10_000 },
    { userId: "c", rank: 3, elapsedMs: 30_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("a"), 350_000n);
  assert.equal(amounts.get("b"), 350_000n);
  assert.equal(amounts.get("c"), 100_000n);
});

test("distributes the 20 percent tail by inverse completion time", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "b", rank: 2, elapsedMs: 20_000 },
    { userId: "c", rank: 3, elapsedMs: 30_000 },
    { userId: "d", rank: 4, elapsedMs: 40_000 },
    { userId: "e", rank: 5, elapsedMs: 80_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("d"), 133_334n);
  assert.equal(amounts.get("e"), 66_666n);
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), USDT);
});

test("returns no awards for an empty or zero-value pool", () => {
  assert.deepEqual(calculatePrizeAllocations(0n, [{ userId: "a", rank: 1, elapsedMs: 1 }]), []);
  assert.deepEqual(calculatePrizeAllocations(USDT, []), []);
});
