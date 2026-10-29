ALTER TABLE "users"
  ADD COLUMN "contestParticipationBlocked" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contestParticipationBlockedAt" TIMESTAMP(3),
  ADD COLUMN "contestParticipationBlockedById" TEXT,
  ADD COLUMN "contestParticipationBlockReason" TEXT;

CREATE TABLE "security_flags" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "contestId" TEXT NOT NULL,
  "reason" TEXT NOT NULL,
  "completionTimeMs" BIGINT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "security_flags_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "security_flags_userId_contestId_key" ON "security_flags"("userId", "contestId");
CREATE INDEX "security_flags_createdAt_idx" ON "security_flags"("createdAt");
CREATE INDEX "security_flags_userId_createdAt_idx" ON "security_flags"("userId", "createdAt");

ALTER TABLE "security_flags" ADD CONSTRAINT "security_flags_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "security_flags" ADD CONSTRAINT "security_flags_contestId_fkey"
  FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;
