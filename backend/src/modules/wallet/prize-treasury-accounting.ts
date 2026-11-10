export interface PrizeRoundReserveTotals {
  seededMicro: bigint;
  rolloverInMicro?: bigint;
  rolloverOutMicro?: bigint;
  returnedToGlobalMicro?: bigint;
  paidAwardsMicro?: bigint;
}

/**
 * Calculates the still-committed portion of historical per-round allocations.
 * Rollover-out and returned-to-global are mirrored columns for the same return
 * and must never be subtracted twice. Paid awards are no longer round reserves:
 * they are represented by the user's internal wallet liability.
 */
export function calculateOutstandingPrizeRoundReserve(totals: PrizeRoundReserveTotals): bigint {
  const seeded = totals.seededMicro > 0n ? totals.seededMicro : 0n;
  const rolloverIn = (totals.rolloverInMicro ?? 0n) > 0n ? totals.rolloverInMicro! : 0n;
  const rolloverOut = (totals.rolloverOutMicro ?? 0n) > 0n ? totals.rolloverOutMicro! : 0n;
  const returnedToGlobal = (totals.returnedToGlobalMicro ?? 0n) > 0n ? totals.returnedToGlobalMicro! : 0n;
  const returned = rolloverOut > returnedToGlobal ? rolloverOut : returnedToGlobal;
  const paid = (totals.paidAwardsMicro ?? 0n) > 0n ? totals.paidAwardsMicro! : 0n;
  const committedBeforePaid = seeded + rolloverIn > returned ? seeded + rolloverIn - returned : 0n;
  return committedBeforePaid > paid ? committedBeforePaid - paid : 0n;
}
