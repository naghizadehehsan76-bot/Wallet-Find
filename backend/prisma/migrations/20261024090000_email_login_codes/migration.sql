CREATE TABLE "email_login_codes" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "email_login_codes_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "email_login_codes_email_createdAt_idx" ON "email_login_codes"("email", "createdAt");
CREATE INDEX "email_login_codes_expiresAt_idx" ON "email_login_codes"("expiresAt");
