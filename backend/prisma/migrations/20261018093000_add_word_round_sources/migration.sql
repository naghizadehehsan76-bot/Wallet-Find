-- Add source-page metadata and multiple-choice options for English word rounds.
ALTER TABLE "contest_clues"
  ADD COLUMN "sourceUrl" TEXT,
  ADD COLUMN "hintAnchor" TEXT,
  ADD COLUMN "options" JSONB;
