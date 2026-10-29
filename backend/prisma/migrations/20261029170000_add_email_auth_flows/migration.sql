ALTER TABLE "users"
ADD COLUMN "emailVerifiedAt" TIMESTAMP(3) DEFAULT CURRENT_TIMESTAMP;

CREATE TABLE "auth_challenges" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "auth_challenges_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "auth_challenges_email_purpose_createdAt_idx"
ON "auth_challenges"("email", "purpose", "createdAt");

CREATE INDEX "auth_challenges_expiresAt_idx"
ON "auth_challenges"("expiresAt");
