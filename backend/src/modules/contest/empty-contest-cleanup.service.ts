import prisma from "../../config/prisma.js";

const EMPTY_CHALLENGE_RETENTION_GRACE_MS = 60_000;
const CLEANUP_BATCH_SIZE = 250;
const MAX_BATCHES_PER_RUN = 4;

/**
 * Removes expired rounds that never received a submission.
 *
 * Financial rows and advertiser orders remain attached to a minimal contest
 * record so their audit trail stays queryable. Clue payloads are removed from
 * every expired empty round. Source-visit snapshots survive because their
 * contest/clue foreign keys use SET NULL.
 *
 * Work is deliberately batched so historical cleanup cannot monopolize the
 * small production PostgreSQL instance.
 */
export async function cleanupExpiredEmptyChallenges(now = new Date()) {
  const cutoff = new Date(now.getTime() - EMPTY_CHALLENGE_RETENTION_GRACE_MS);
  let deletedClues = 0;
  let deletedContests = 0;

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const count = await prisma.$executeRaw`
      WITH batch AS (
        SELECT contest.id
        FROM "contests" AS contest
        WHERE contest.status IN ('FINISHED', 'CANCELLED')
          AND contest."endsAt" IS NOT NULL
          AND contest."endsAt" <= ${cutoff}
          AND NOT EXISTS (
            SELECT 1 FROM "submissions" AS submission
            WHERE submission."contestId" = contest.id
          )
          AND EXISTS (
            SELECT 1 FROM "contest_clues" AS clue
            WHERE clue."contestId" = contest.id
          )
        ORDER BY contest."endsAt" ASC, contest.id ASC
        LIMIT ${CLEANUP_BATCH_SIZE}
        FOR UPDATE OF contest SKIP LOCKED
      )
      DELETE FROM "contest_clues" AS clue
      USING batch
      WHERE clue."contestId" = batch.id
    `;
    deletedClues += count;
    if (count === 0) break;
  }

  for (let batch = 0; batch < MAX_BATCHES_PER_RUN; batch += 1) {
    const count = await prisma.$executeRaw`
      WITH batch AS (
        SELECT contest.id
        FROM "contests" AS contest
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
            SELECT 1 FROM "wallet_transactions" AS wallet_tx
            WHERE wallet_tx."contestId" = contest.id
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
        ORDER BY contest."endsAt" ASC, contest.id ASC
        LIMIT ${CLEANUP_BATCH_SIZE}
        FOR UPDATE OF contest SKIP LOCKED
      )
      DELETE FROM "contests" AS contest
      USING batch
      WHERE contest.id = batch.id
    `;
    deletedContests += count;
    if (count === 0) break;
  }

  return { deletedContests, deletedClues };
}
