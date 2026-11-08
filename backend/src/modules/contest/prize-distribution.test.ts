import test from "node:test";
import assert from "node:assert/strict";
import { calculatePrizeAllocations } from "./prize-distribution.js";

const USDT = 1_000_000n;

test("allocates exactly 50/25/12.5/12.5 percent to ranks one through four", () => {
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
  assert.equal(amounts.get("d"), 125_000n);
  assert.equal(amounts.has("e"), false, "rank five and below receive no prize");
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), USDT);
});

test("splits an exact tie at any paid rank equally", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "b", rank: 1, elapsedMs: 10_000 },
    { userId: "c", rank: 2, elapsedMs: 20_000 },
    { userId: "d", rank: 3, elapsedMs: 30_000 },
    { userId: "e", rank: 4, elapsedMs: 40_000 },
    { userId: "f", rank: 4, elapsedMs: 40_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("a"), 250_000n);
  assert.equal(amounts.get("b"), 250_000n);
  assert.equal(amounts.get("c"), 250_000n);
  assert.equal(amounts.get("d"), 125_000n);
  assert.equal(amounts.get("e"), 62_500n);
  assert.equal(amounts.get("f"), 62_500n);
});

test("does not redistribute missing rank shares to lower-ranked finishers", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "d", rank: 4, elapsedMs: 40_000 },
    { userId: "e", rank: 5, elapsedMs: 80_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("a"), 500_000n);
  assert.equal(amounts.get("d"), 125_000n);
  assert.equal(amounts.has("e"), false);
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), 625_000n);
});

test("returns no awards for an empty or zero-value pool", () => {
  assert.deepEqual(calculatePrizeAllocations(0n, [{ userId: "a", rank: 1, elapsedMs: 1 }]), []);
  assert.deepEqual(calculatePrizeAllocations(USDT, []), []);
});
