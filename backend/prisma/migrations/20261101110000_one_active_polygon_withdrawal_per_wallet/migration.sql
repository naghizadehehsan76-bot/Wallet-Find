-- Prevent concurrent Turnkey sends from the same custodial wallet.
-- A wallet may have only one withdrawal in the signing/broadcast lifecycle at a time.
CREATE UNIQUE INDEX "wallet_withdrawals_one_active_per_wallet_idx"
ON "wallet_withdrawals" ("walletAccountId")
WHERE "status" IN ('SIGNING', 'BROADCAST');
