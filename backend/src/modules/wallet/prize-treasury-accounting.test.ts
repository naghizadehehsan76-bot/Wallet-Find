import assert from "node:assert/strict";
import { test } from "node:test";
import { calculateOutstandingPrizeRoundReserve } from "./prize-treasury-accounting.js";

test("does not reserve amounts already returned and paid from a legacy round", () => {
  assert.equal(calculateOutstandingPrizeRoundReserve({
    seededMicro: 500_000n,
    rolloverOutMicro: 300_000n,
    returnedToGlobalMicro: 300_000n,
    paidAwardsMicro: 200_000n,
  }), 0n);
});

test("counts mirrored return columns only once", () => {
  assert.equal(calculateOutstandingPrizeRoundReserve({
    seededMicro: 100_000n,
    rolloverOutMicro: 25_000n,
    returnedToGlobalMicro: 25_000n,
  }), 75_000n);
});

test("keeps unpaid winner awards committed until they are paid", () => {
  assert.equal(calculateOutstandingPrizeRoundReserve({
    seededMicro: 100_000n,
    rolloverOutMicro: 50_000n,
    returnedToGlobalMicro: 50_000n,
    paidAwardsMicro: 0n,
  }), 50_000n);
});

test("releases paid winner awards from the round reserve", () => {
  assert.equal(calculateOutstandingPrizeRoundReserve({
    seededMicro: 100_000n,
    rolloverInMicro: 20_000n,
    rolloverOutMicro: 40_000n,
    returnedToGlobalMicro: 40_000n,
    paidAwardsMicro: 80_000n,
  }), 0n);
});

test("never returns a negative reserve for inconsistent historical totals", () => {
  assert.equal(calculateOutstandingPrizeRoundReserve({
    seededMicro: 10_000n,
    returnedToGlobalMicro: 20_000n,
    paidAwardsMicro: 50_000n,
  }), 0n);
});
