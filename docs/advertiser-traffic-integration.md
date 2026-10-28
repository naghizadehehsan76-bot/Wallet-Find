# Advertiser traffic verification foundation

## What exists now

Wallet-Find logs one authenticated click per user and clue in `contest_source_visits`. Each row now has an opaque `trackingToken` that can correlate a Wallet-Find click with an advertiser-side record later. The token is returned by the authenticated click-recording API but is **not yet added to the external URL**.

The internal report now separates:
- `NOT_CONFIGURED`: no advertiser-side verification integration is configured;
- `PENDING`: a future integration has begun verification but has not confirmed the landing;
- `CONFIRMED`: the partner's authenticated API/callback has been checked and the landing was matched;
- `REJECTED`: the partner response did not validate the landing.

Only `CONFIRMED` should be described to a sponsor as an advertiser-confirmed landing. A Wallet-Find click is not the same as a page successfully loading on the external site.

## What we need from the advertiser before enabling it

Do not invent a query parameter or assume that all partners use the same protocol. Request these details from the advertiser's technical contact:

1. The final destination URL and exact campaign/landing page.
2. Their preferred click-ID parameter name and behavior (for example, whether their system accepts an opaque per-click ID in the URL).
3. API documentation and sandbox/test credentials.
4. The supported verification flow: signed webhook/callback, server-to-server lookup/polling API, or another documented method.
5. Authentication and signature requirements, timestamp tolerance, retry policy, rate limits, response schema, and the meaning of a confirmed landing.
6. Their rules for bot traffic, duplicate requests, redirects, and how long after a click a landing can be attributed.
7. An agreed test procedure and how both sides will reconcile totals.

## Integration rules

- Implement a provider-specific adapter from the advertiser's actual documentation. The common database fields are provider-neutral; the HTTP protocol is intentionally not enabled yet.
- Add the tracking token to the outbound URL only after agreeing the exact parameter name and placement with the advertiser. Do not send username, email, or other direct identity data as the click ID.
- Keep API keys, HMAC secrets, OAuth credentials, and other secrets in the deployment platform's secret/environment settings. Never commit them to GitHub or store them in public frontend code.
- The provider adapter must authenticate the advertiser's callback/API response and validate the click ID before invoking `confirmAdvertiserLanding` in `backend/src/modules/contest/advertiser-verification.service.ts`. The service is internal and deliberately has no public HTTP route.
- Make confirmation idempotent. Retries of the same valid partner reference should not inflate counts; a conflicting confirmation should be investigated instead of overwriting a previous result.
- Keep the advertiser's original click/landing reference and confirmation timestamp for reconciliation. Do not store raw partner responses if they contain unnecessary personal or sensitive data.
- Report Wallet-Find click totals, advertiser-confirmed landings, pending checks, and unconfigured records separately in sponsor-facing exports.

## Still pending until a contract exists

The click-token foundation, storage fields, administrator report distinctions, and internal confirmation service are prepared. The live URL decoration, provider authentication, network/API connector, callback or polling endpoint, and end-to-end tests must be implemented after the advertiser supplies the real API specification. Until then, records remain `NOT_CONFIGURED` and must not be presented as confirmed external visits.
