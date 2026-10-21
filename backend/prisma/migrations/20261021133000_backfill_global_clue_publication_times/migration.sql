-- Backfill a stable, contest-wide publication timestamp for existing clues.
-- This is needed for active MVP contests and manually activated contests created
-- before global per-clue timestamps were assigned on activation.
UPDATE "contest_clues" AS clue
SET "publishedAt" =
  contest."startsAt"
  + ((clue."sequence" - 1) * COALESCE(setting."publishIntervalMinutes", 2))
    * INTERVAL '1 minute'
FROM "contests" AS contest
LEFT JOIN "contest_settings" AS setting
  ON setting."contestId" = contest."id"
WHERE clue."contestId" = contest."id"
  AND clue."publishedAt" IS NULL
  AND contest."startsAt" IS NOT NULL;
