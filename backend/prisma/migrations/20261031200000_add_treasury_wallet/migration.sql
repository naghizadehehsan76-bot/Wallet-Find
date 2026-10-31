CREATE TABLE "treasury_wallets" (
  "id" TEXT NOT NULL,
  "turnkeyWalletId" TEXT,
  "address" TEXT,
  "chainId" INTEGER NOT NULL DEFAULT 137,
  "networkKey" TEXT NOT NULL DEFAULT 'polygon',
  "status" TEXT NOT NULL DEFAULT 'CREATING',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "treasury_wallets_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "treasury_wallets_turnkeyWalletId_key" ON "treasury_wallets"("turnkeyWalletId");
CREATE UNIQUE INDEX "treasury_wallets_address_key" ON "treasury_wallets"("address");
