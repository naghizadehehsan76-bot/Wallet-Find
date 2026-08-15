# Wallet-Find / 12Keys — Security Rules

## Secrets

Never commit:
- database URLs/passwords
- JWT secrets
- API keys
- private keys
- wallet seed phrases
- production credentials

`.env` files containing real secrets must remain ignored.

## Authentication

- JWT is required for participant and admin APIs.
- JWT role claims must be validated server-side.
- Passwords must be stored only as strong password hashes.
- Authentication failures should use stable generic error messages.

## Authorization

- Admin operations require the ADMIN role.
- Normal users must never be able to create, activate, finish, or modify contests.
- The frontend must never be trusted for authorization.

## Contest integrity

The backend is authoritative for:
- active contest
- current clue
- clue progression
- answer correctness
- response timing
- completion
- ranking

A client must not be able to:
- skip clues
- submit future clues
- mark a clue solved locally
- set its own response time
- change its role
- alter leaderboard results

## Answer protection

Correct answers must never be returned to normal clients.

Player-facing APIs may return clue content and metadata but must exclude `correctAnswer`.

Answer verification must happen only on the server.

## Abuse protection

Authentication endpoints are rate-limited.

Answer submission endpoints are rate-limited.

JSON request bodies have a bounded size.

Future production deployment should add infrastructure-level rate limiting or a trusted edge/WAF where appropriate.

## HTTP security

Helmet is enabled.

CORS must be configured explicitly for production with `CORS_ORIGIN`.

HTTPS is required in production.

Do not expose stack traces or internal errors to end users.

## Database security

Use Prisma parameterized operations.

Never construct SQL from unsanitized user input.

Use least-privilege production database credentials.

Backups must be configured before production launch.

## Logging

Do not log:
- passwords
- password hashes
- JWTs
- database credentials
- correct answers
- private wallet keys

Audit logs may record administrative actions and entity identifiers.

## Wallet security

MVP wallet UI is display-only.

No private key or seed phrase should ever be collected by Wallet-Find for a real wallet account.

Real withdrawal implementation must use a dedicated security review and transaction-signing architecture.

## Production checklist

Before production:
- rotate development secrets
- configure production CORS
- enable HTTPS
- configure backups
- enable monitoring
- review rate limits
- review JWT lifetime and revocation strategy
- verify no secrets are present in Git history
- run security regression tests
