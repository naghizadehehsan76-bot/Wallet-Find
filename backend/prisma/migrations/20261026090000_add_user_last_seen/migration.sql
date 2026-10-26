ALTER TABLE "users"
ADD COLUMN "lastSeenAt" TIMESTAMP(3);

CREATE INDEX "users_lastSeenAt_idx"
ON "users"("lastSeenAt");
