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
