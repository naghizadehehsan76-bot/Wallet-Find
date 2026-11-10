-- Snapshot whether the shared prize fund had a positive balance when a user first joined a challenge.
-- Existing submissions intentionally default to false: historic participation cannot gain retroactive eligibility.
ALTER TABLE "submissions"
ADD COLUMN "prizeEligibleAtJoin" BOOLEAN NOT NULL DEFAULT false;
