import prisma from "../../config/prisma.js";

const EMPTY_CHALLENGE_RETENTION_GRACE_MS = 60_000;

/**
 * Removes expired rounds that never received a submission.
 *
 * Financial rows and advertiser orders remain attached to a minimal contest
 * record so their audit trail stays queryable. Clue payloads are removed from
 * every expired empty round. Source-visit snapshots survive because their
 * contest/clue foreign keys use SET NULL.
 */
export async function cleanupExpiredEmptyChallenges(now = new Date()) {
  const cutoff = new Date(now.getTime() - EMPTY_CHALLENGE_RETENTION_GRACE_MS);

  const deletedClues = await prisma.$executeRaw`
    DELETE FROM "contest_clues" AS clue
    USING "contests" AS contest
    WHERE clue."contestId" = contest.id
      AND contest.status IN ('FINISHED', 'CANCELLED')
      AND contest."endsAt" IS NOT NULL
      AND contest."endsAt" <= ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM "submissions" AS submission
        WHERE submission."contestId" = contest.id
      )
  `;

  const deletedContests = await prisma.$executeRaw`
    DELETE FROM "contests" AS contest
    WHERE contest.status IN ('FINISHED', 'CANCELLED')
      AND contest."endsAt" IS NOT NULL
      AND contest."endsAt" <= ${cutoff}
      AND NOT EXISTS (
        SELECT 1 FROM "submissions" AS submission
        WHERE submission."contestId" = contest.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "prize_awards" AS award
        WHERE award."contestId" = contest.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "prize_ledger" AS ledger
        WHERE ledger."contestId" = contest.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "global_prize_ledger" AS ledger
        WHERE ledger."contestId" = contest.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "wallet_transactions" AS transaction
        WHERE transaction."contestId" = contest.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "advertisement_orders" AS order_record
        WHERE order_record."contestId" = contest.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "contest_settings" AS setting
        WHERE setting."contestId" = contest.id
      )
      AND NOT EXISTS (
        SELECT 1 FROM "prize_pools" AS pool
        WHERE pool."contestId" = contest.id
          AND (
            pool."seededMicro" <> 0
            OR COALESCE(pool."rolloverInMicro", 0) <> 0
            OR COALESCE(pool."rolloverOutMicro", 0) <> 0
            OR pool."awardedMicro" <> 0
            OR pool."projectProfitMicro" <> 0
            OR COALESCE(pool."returnedToGlobalMicro", 0) <> 0
          )
      )
  `;

  return { deletedContests, deletedClues };
}
