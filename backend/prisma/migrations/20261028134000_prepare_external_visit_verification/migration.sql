-- Prepare per-click correlation and explicit partner-side landing verification.
-- The click token is not appended to destination URLs until an advertiser's tracking
-- contract defines the exact query parameter or callback protocol.
CREATE TYPE "ExternalVisitVerificationStatus" AS ENUM (
  'NOT_CONFIGURED',
  'PENDING',
  'CONFIRMED',
  'REJECTED'
);

ALTER TABLE "contest_source_visits"
  ADD COLUMN "trackingToken" TEXT,
  ADD COLUMN "externalVerificationStatus" "ExternalVisitVerificationStatus" NOT NULL DEFAULT 'NOT_CONFIGURED',
  ADD COLUMN "externalConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "externalVerificationProvider" TEXT,
  ADD COLUMN "externalReferenceId" TEXT;

UPDATE "contest_source_visits"
SET "trackingToken" = gen_random_uuid()::text
WHERE "trackingToken" IS NULL;

ALTER TABLE "contest_source_visits"
  ALTER COLUMN "trackingToken" SET NOT NULL;

CREATE UNIQUE INDEX "contest_source_visits_trackingToken_key"
  ON "contest_source_visits"("trackingToken");

CREATE INDEX "contest_source_visits_externalVerificationStatus_createdAt_idx"
  ON "contest_source_visits"("externalVerificationStatus", "createdAt");

CREATE INDEX "contest_source_visits_externalVerificationProvider_createdAt_idx"
  ON "contest_source_visits"("externalVerificationProvider", "createdAt");
