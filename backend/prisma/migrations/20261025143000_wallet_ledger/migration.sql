CREATE TABLE "wallet_transactions" (
    "id" TEXT NOT NULL, "userId" TEXT NOT NULL, "type" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED', "amountMicro" BIGINT NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'USDT', "note" TEXT NOT NULL, "referenceKey" TEXT,
    "contestId" TEXT, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL, CONSTRAINT "wallet_transactions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "wallet_transactions_referenceKey_key" ON "wallet_transactions"("referenceKey");
CREATE INDEX "wallet_transactions_userId_createdAt_idx" ON "wallet_transactions"("userId", "createdAt");
CREATE INDEX "wallet_transactions_userId_status_type_idx" ON "wallet_transactions"("userId", "status", "type");
ALTER TABLE "wallet_transactions" ADD CONSTRAINT "wallet_transactions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
