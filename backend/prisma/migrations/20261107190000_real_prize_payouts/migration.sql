-- Add durable payout tracking without rewriting historical prize records.
ALTER TABLE "prize_awards"
  ADD COLUMN "destinationAddress" TEXT,
  ADD COLUMN "transactionHash" TEXT,
  ADD COLUMN "broadcastAt" TIMESTAMP(3),
  ADD COLUMN "confirmedAt" TIMESTAMP(3),
  ADD COLUMN "failureCode" TEXT;

CREATE UNIQUE INDEX "prize_awards_transactionHash_key"
  ON "prize_awards"("transactionHash");
CREATE INDEX "prize_awards_status_createdAt_idx"
  ON "prize_awards"("status", "createdAt");
