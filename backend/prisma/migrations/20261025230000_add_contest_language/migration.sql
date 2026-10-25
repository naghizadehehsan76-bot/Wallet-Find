ALTER TABLE "contests" ADD COLUMN "language" TEXT NOT NULL DEFAULT 'en';

CREATE INDEX "contests_language_status_startsAt_idx" ON "contests"("language", "status", "startsAt");
