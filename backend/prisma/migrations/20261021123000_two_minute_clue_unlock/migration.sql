-- Make two minutes the default clue-unlock interval and migrate existing settings.
ALTER TABLE "contest_settings"
  ALTER COLUMN "publishIntervalMinutes" SET DEFAULT 2;

UPDATE "contest_settings"
SET "publishIntervalMinutes" = 2
WHERE "publishIntervalMinutes" = 15;
