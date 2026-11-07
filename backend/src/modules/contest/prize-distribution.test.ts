import test from "node:test";
import assert from "node:assert/strict";
import { calculatePrizeAllocations } from "./prize-distribution.js";

const USDT = 1_000_000n;

test("allocates fixed 50/25/12.5 podium shares and 12.5 percent to rank 4+", () => {
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
  assert.equal(amounts.get("d"), 83_333n);
  assert.equal(amounts.get("e"), 41_667n);
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), USDT);
});

test("splits an exact podium-rank tie equally without changing other rank shares", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "b", rank: 1, elapsedMs: 10_000 },
    { userId: "c", rank: 2, elapsedMs: 20_000 },
    { userId: "d", rank: 3, elapsedMs: 30_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("a"), 250_000n);
  assert.equal(amounts.get("b"), 250_000n);
  assert.equal(amounts.get("c"), 250_000n);
  assert.equal(amounts.get("d"), 125_000n);
});

test("distributes the 12.5 percent tail by inverse completion time", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "b", rank: 2, elapsedMs: 20_000 },
    { userId: "c", rank: 3, elapsedMs: 30_000 },
    { userId: "d", rank: 4, elapsedMs: 40_000 },
    { userId: "e", rank: 5, elapsedMs: 80_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("d"), 83_333n);
  assert.equal(amounts.get("e"), 41_667n);
});

test("leaves missing podium shares unused", () => {
  const awards = calculatePrizeAllocations(USDT, [
    { userId: "a", rank: 1, elapsedMs: 10_000 },
    { userId: "d", rank: 4, elapsedMs: 40_000 },
  ]);
  const amounts = new Map(awards.map((award) => [award.userId, award.amountMicro]));
  assert.equal(amounts.get("a"), 500_000n);
  assert.equal(amounts.get("d"), 125_000n);
  assert.equal(awards.reduce((sum, award) => sum + award.amountMicro, 0n), 625_000n);
});

test("returns no awards for an empty or zero-value pool", () => {
  assert.deepEqual(calculatePrizeAllocations(0n, [{ userId: "a", rank: 1, elapsedMs: 1 }]), []);
  assert.deepEqual(calculatePrizeAllocations(USDT, []), []);
});
