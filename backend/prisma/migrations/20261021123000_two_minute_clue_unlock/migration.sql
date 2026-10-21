-- Make two minutes the default clue-unlock interval for new and existing contests.
ALTER TABLE "contest_settings"
  ALTER COLUMN "publishIntervalMinutes" SET DEFAULT 2;

UPDATE "contest_settings"
SET "publishIntervalMinutes" = 2;
