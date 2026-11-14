ALTER TABLE "contest_settings"
  ALTER COLUMN "firstPrizePercent" TYPE DECIMAL(5, 2)
    USING "firstPrizePercent"::DECIMAL(5, 2),
  ALTER COLUMN "secondPrizePercent" TYPE DECIMAL(5, 2)
    USING "secondPrizePercent"::DECIMAL(5, 2),
  ALTER COLUMN "thirdPrizePercent" TYPE DECIMAL(5, 2)
    USING "thirdPrizePercent"::DECIMAL(5, 2);

ALTER TABLE "contest_settings"
  ALTER COLUMN "firstPrizePercent" SET DEFAULT 50.00,
  ALTER COLUMN "secondPrizePercent" SET DEFAULT 25.00,
  ALTER COLUMN "thirdPrizePercent" SET DEFAULT 12.50;

-- Replace legacy stored splits so existing settings match the current
-- 50 / 25 / 12.5 / 12.5 weighted-remainder distribution.
UPDATE "contest_settings"
SET
  "firstPrizePercent" = 50.00,
  "secondPrizePercent" = 25.00,
  "thirdPrizePercent" = 12.50;
