# Turnkey staged activation checklist

This integration is not approved for production financial processing.

## Current scope
- Authenticated read-only wallet data endpoint for Ethereum, Optimism, Polygon, and Arbitrum.
- Native-data endpoint remains disabled unless TURNKEY_NATIVE_DATA_API_ENABLED=true.
- Bitcoin and BNB remain disabled.
- The webhook endpoint verifies the exact raw request body, validates the Turnkey signature and timestamp, and stores each event once in the durable inbox.
- Webhook events do not currently credit balances or create deposit journal entries.
- Keep the existing Polygon scanner until a replacement has passed end-to-end reconciliation.

## Configuration
After creating the webhook in the correct Turnkey organization, configure these Render environment variables using the values supplied by Turnkey:
- TURNKEY_WEBHOOK_KEY_ID
- TURNKEY_WEBHOOK_PUBLIC_KEY

Do not place credentials in source code, GitHub comments, or client-side configuration. Keep TURNKEY_NATIVE_DATA_API_ENABLED off until read-only responses have been verified.

## Validation sequence
1. Configure the Turnkey webhook URL as the production backend URL followed by /api/webhooks/turnkey.
2. Obtain the exact event names, signature key ID, public verification key, and representative event payload from Turnkey.
3. Confirm a signed test event is persisted in turnkey_webhook_events.
4. Replay the same event and confirm only one inbox row exists.
5. Modify a signed test payload and confirm signature verification rejects it without storing a row.
6. Confirm no test event changes a user's spendable balance.

If the exact event payload contract is unavailable, stop and request it from Turnkey. Do not invent event fields or treat a webhook as proof of funds.

## Requirements before automatic deposit credit
A separate reviewed implementation must validate the organization, wallet/address, CAIP-2 network, enabled asset and contract, transaction hash and log identity, amount, recipient, on-chain transaction status, and configured finality. It must map the event to one user and one enabled asset, post balanced journal entries atomically using a stable idempotency key, and safely handle duplicates, delayed events, and chain reorganizations. Unknown or ambiguous events must be quarantined for manual review.

## Production gate
Before merge or deployment, inspect production migration history, take and verify a restorable database backup, review the additive inbox migration, verify the Turnkey and Render configuration, and confirm CI passes on the exact PR head. Deploy with financial processing disabled and test signature rejection, inbox persistence, and duplicate handling. Do not remove the Polygon scanner until the replacement lifecycle passes reconciliation and recovery tests.


## Wallet-Find accounting and UI integration

The existing EVM deposit scanner is the authoritative deposit detector and posts a balanced `DEPOSIT_CREDIT` journal only after the configured canonicality/finality checks. A source-chain reorganization posts an exact inverse `DEPOSIT_REVERSAL` journal and suspends the affected wallet for review. Do not also credit the same deposit from a Turnkey webhook; that would double-credit the user.

The existing Turnkey-backed withdrawal path reserves the requested asset and the network-native fee in the double-entry journal before admin review. The approved request is signed/broadcast through the user's Turnkey sub-organization. After canonical receipt and finality checks, the amount and actual network fee are settled from reserved balances and unused fee reserve is released. Failed canonical transactions release the amount reservation. Uncertain signing/broadcast outcomes remain reserved for reconciliation rather than being automatically released.

The wallet UI now resolves each enabled deposit/withdrawal asset against its own network instead of assuming Polygon. It displays the native fee asset for the selected network. Existing legacy wallet transactions and legacy balances remain visible as a separate compatibility balance; they are not silently copied into the multi-asset journal and are not overwritten by Turnkey on-chain balance reads.

Turnkey's Balance API is an on-chain custody observation, not the user's spendable Wallet-Find ledger balance. Keep these figures separate in the UI and never use a raw provider balance response to credit a user. The journal is the source of truth for spendable/ reserved amounts; the chain scanner and canonical transaction reconciliation are the source of truth for external deposits and withdrawals.

## Required end-to-end tests before enabling live operations

- Send a small supported-asset deposit to a test wallet and verify exactly one scanner deposit row, one balanced deposit journal, one balance increase, and one history row.
- Replay the same transfer scan and verify no second credit is created.
- Reject a below-minimum or non-allowlisted asset without changing the ledger.
- Submit a small withdrawal, verify amount and native fee reservations, approve it, verify Turnkey broadcasts once, and reconcile a canonical successful receipt to final settlement.
- Reject a withdrawal and verify both amount and fee reservations are released.
- Simulate a reverted transaction and verify amount release plus actual fee settlement.
- Verify old `wallet_transactions`, `wallet_deposits`, and `wallet_withdrawals` remain visible and unchanged; do not convert their historical totals into new journal credits without a separately reviewed reconciliation plan.
- Compare Turnkey on-chain balances against the custody-side journal asset totals; investigate any difference before raising withdrawal limits.
