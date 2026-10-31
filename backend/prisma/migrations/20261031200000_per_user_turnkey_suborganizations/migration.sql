-- Give every existing account legacy verification status before enforcing
-- server-side verification for wallet provisioning. New registrations remain unverified.
UPDATE "users"
SET "emailVerifiedAt" = COALESCE("emailVerifiedAt", "createdAt")
WHERE "emailVerifiedAt" IS NULL;

-- Keep references to previously provisioned parent-organization wallets so no
-- historical address is silently lost when the user receives a dedicated sub-org.
ALTER TABLE "wallet_accounts"
  ADD COLUMN "turnkeyOrganizationId" TEXT,
  ADD COLUMN "turnkeyApiPublicKey" TEXT,
  ADD COLUMN "turnkeyApiPrivateKeyEncrypted" TEXT,
  ADD COLUMN "legacyTurnkeyWalletId" TEXT,
  ADD COLUMN "legacyAddress" TEXT;

UPDATE "wallet_accounts"
SET
  "legacyTurnkeyWalletId" = "turnkeyWalletId",
  "legacyAddress" = "address"
WHERE "turnkeyOrganizationId" IS NULL
  AND "legacyAddress" IS NULL;

CREATE UNIQUE INDEX "wallet_accounts_turnkeyOrganizationId_key"
  ON "wallet_accounts"("turnkeyOrganizationId");
