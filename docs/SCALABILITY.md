# Wallet-Find — Scalability and Horizontal Deployment

## Goal

Wallet-Find must grow by increasing Render resources and adding service instances, not by rewriting contest, wallet, or payment business logic. API processes must remain stateless with respect to correctness and financial state. PostgreSQL remains the durable source of truth.

## Process roles

The same backend build supports two execution roles:

| Role | Entry point | Responsibility |
|---|---|---|
| `all` | `node dist/server.js` | Backwards-compatible single service: HTTP API plus background processors |
| `web` | `node dist/server.js` with `APP_ROLE=web` | HTTP API only; no schedulers or background processors |
| `worker` | `node dist/worker.js` with `APP_ROLE=worker` | Background processors only; no public HTTP listener |

The current deployment remains compatible because the API defaults to `APP_ROLE=all`. A Worker service can be added later from the same repository and build artifact.

**Safe migration order when ready to split services:**

1. Add the Render Background Worker using `cd backend && npm run start:worker`.
2. Set `APP_ROLE=worker` on the Worker service and share the same `DATABASE_URL` and required wallet/provider environment variables.
3. Verify the Worker is processing and the distributed leases are active.
4. Change the Web Service to `APP_ROLE=web`.
5. Only then increase the number of API or Worker instances.

Do not switch the Web Service to `APP_ROLE=web` before a Worker is live, or recurring challenge and wallet processing will stop.

## Cross-instance coordination

- `system_job_leases` provides owner-checked, renewable PostgreSQL leases for singleton tasks such as challenge scheduling, prize settlement, prize crediting, Polygon treasury scanning, and withdrawal reconciliation.
- Generic wallet chain scanning already uses a per-network database lease and cursor.
- Turnkey webhook events are claimed with conditional database updates; duplicate event delivery is also protected by unique event IDs and idempotent deposit/journal keys.
- Prize crediting and wallet journal posting retain their transaction-level locks and idempotency keys. The shared worker lease is an outer coordination layer, not a replacement for financial idempotency.
- Leases expire automatically after process crashes. Workers renew leases while jobs are running and release them only when they still own the lease.

Any new periodic or scheduled task must either use `runWithSystemJobLease`, an existing per-resource lease, or an atomic per-record claim. A process-local `running` boolean is only an optimization; it is never sufficient for multiple instances.

## Shared request limits

Authentication, challenge answer, and market-price rate limits use the shared PostgreSQL counter store. Limits therefore apply across all API instances rather than resetting independently on each process.

When a dedicated Valkey/Redis service is introduced, the store can be replaced with a Redis-backed implementation without changing the endpoint business logic. Do not use an eviction policy that can silently discard queue data if Valkey is later used as a job broker.

## PostgreSQL connection budget

Each Node process uses one shared Prisma client with a bounded `pg` pool. Configure `DATABASE_POOL_MAX` per process. The total theoretical connection budget is:

`API instances × API pool max + Worker instances × Worker pool max + migrations/admin connections`

Keep that sum below the connection capacity available to the PostgreSQL plan. Do not increase each process pool by default when adding instances. Use Render's pooled database connection string/connection pooler when the database plan supports it and the runtime is configured for it.

Default per-process pool maximum is 5. It is configurable from 1 to 20 using `DATABASE_POOL_MAX`; pool acquire and idle timeouts are also configurable.

## Contest ranking

The leaderboard query aggregates submissions in PostgreSQL and returns one summary row per participant. It no longer downloads every answer attempt into Node.js memory. The query uses the contest/submission timestamp index, sorts on the server, and caps a response at 5,000 rows. Prize settlement uses the same authoritative aggregate calculation.

The submission table remains append-only for answer attempts; any future long-term archival or partitioning strategy must preserve the transaction and prize-settlement audit trail.

## Financial and timing invariants

Horizontal scaling must preserve all of the following:

- Server-side answer validation, one-language participation rules, 15-minute challenge boundaries, and answer progression.
- Atomic, idempotent wallet journal postings and deposit/withdrawal state transitions.
- At-most-once prize-award crediting through per-award database locks, unique journal references, and state transitions.
- Exactly one active scheduler owner per lease name at any given lease interval.
- Reconciliation and retry of incomplete external blockchain operations after restarts.

Do not move balances, ranking authority, winner determination, or challenge timing into frontend state or process-local memory.

## Load testing and release gates

Before enabling marketing campaigns or raising the production user limit:

1. Run authenticated API load tests with ramp-up, steady state, and spike phases.
2. Include contest reads, answer submissions, leaderboard reads, wallet reads, and price reads.
3. Verify no duplicate challenge generation, prize settlement, prize credits, deposit credits, or withdrawal broadcasts.
4. Track p50/p95/p99 latency, HTTP 4xx/5xx rates, CPU/memory, PostgreSQL connections, query latency, and lock/lease contention.
5. Increase API instance count and pool size independently; validate the combined database connection budget each time.
6. Record an observed capacity envelope. Do not translate a synthetic virtual-user count into a guaranteed real-user capacity without a realistic traffic mix.

## Render infrastructure policy

The Postgres plan and the Web Service plan are independent Render resources and may intentionally differ. Do not change one to match the other. Keep each resource's Blueprint declaration aligned with the way that resource is intentionally managed in the Render Dashboard; do not sync an unreviewed Blueprint change that could alter a paid resource.
