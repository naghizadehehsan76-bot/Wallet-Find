-- Durable, recoverable Turnkey Sub-Organization provisioning intent.
-- This is additive; existing wallet accounts and legacy addresses are preserved.

CREATE TYPE "WalletProvisioningStatus" AS ENUM (
  'CREATING',
  'COMPLETED',
  'REQUIRES_REVIEW',
  'FAILED'
);

CREATE TABLE "wallet_provisioning_intents" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "idempotencyKey" TEXT NOT NULL,
  "status" "WalletProvisioningStatus" NOT NULL DEFAULT 'CREATING',
  "turnkeyApiPublicKey" TEXT NOT NULL,
  "turnkeyApiPrivateKeyEncrypted" TEXT NOT NULL,
  "turnkeyOrganizationId" TEXT,
  "turnkeyWalletId" TEXT,
  "address" TEXT,
  "failureCode" TEXT,
  "attemptCount" INTEGER NOT NULL DEFAULT 1,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "wallet_provisioning_intents_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "wallet_provisioning_intents_userId_key" ON "wallet_provisioning_intents"("userId");
CREATE UNIQUE INDEX "wallet_provisioning_intents_idempotencyKey_key" ON "wallet_provisioning_intents"("idempotencyKey");
CREATE UNIQUE INDEX "wallet_provisioning_intents_turnkeyOrganizationId_key" ON "wallet_provisioning_intents"("turnkeyOrganizationId");
CREATE UNIQUE INDEX "wallet_provisioning_intents_turnkeyWalletId_key" ON "wallet_provisioning_intents"("turnkeyWalletId");
CREATE INDEX "wallet_provisioning_intents_status_createdAt_idx" ON "wallet_provisioning_intents"("status", "createdAt");

ALTER TABLE "wallet_provisioning_intents"
  ADD CONSTRAINT "wallet_provisioning_intents_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
