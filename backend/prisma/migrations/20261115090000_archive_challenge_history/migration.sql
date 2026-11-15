ALTER TABLE "contests" ADD COLUMN "archivedAt" TIMESTAMP(3);

CREATE INDEX "contests_archivedAt_status_startsAt_idx"
ON "contests"("archivedAt", "status", "startsAt");
