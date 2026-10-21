ALTER TABLE "contest_settings"
  ALTER COLUMN "firstPrizePercent" SET DEFAULT 50;

UPDATE "contest_settings"
SET "firstPrizePercent" = 50
WHERE "firstPrizePercent" = 70;
