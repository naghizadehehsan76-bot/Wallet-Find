import prisma from "./prisma.js";

type RateLimitInfo = {
  totalHits: number;
  resetTime: Date;
};

type RateLimitStoreOptions = {
  windowMs: number;
};

/**
 * express-rate-limit store backed by PostgreSQL so limits remain consistent
 * when multiple API instances serve the same client IP.
 *
 * This deliberately uses one atomic UPSERT per limited request rather than
 * read-then-write logic, which would race under concurrent requests.
 */
export class PostgresRateLimitStore {
  readonly localKeys = false;
  private windowMs = 60_000;
  private operationCount = 0;

  constructor(readonly prefix: string) {}

  init(options: RateLimitStoreOptions): void {
    if (Number.isFinite(options.windowMs) && options.windowMs > 0) {
      this.windowMs = options.windowMs;
    }
  }

  async get(key: string): Promise<RateLimitInfo | undefined> {
    const rows = await prisma.$queryRaw<Array<{ totalHits: number; resetTime: Date }>>`
      SELECT "hits" AS "totalHits", "resetAt" AS "resetTime"
      FROM "rate_limit_counters"
      WHERE "key" = ${this.prefix + key}
        AND "resetAt" > NOW()
      LIMIT 1
    `;
    return rows[0];
  }

  async increment(key: string): Promise<RateLimitInfo> {
    const candidateResetAt = new Date(Date.now() + this.windowMs);
    const rows = await prisma.$queryRaw<Array<{ totalHits: number; resetTime: Date }>>`
      INSERT INTO "rate_limit_counters" ("key", "hits", "resetAt", "updatedAt")
      VALUES (${this.prefix + key}, 1, ${candidateResetAt}, NOW())
      ON CONFLICT ("key") DO UPDATE
      SET
        "hits" = CASE
          WHEN "rate_limit_counters"."resetAt" <= NOW() THEN 1
          ELSE "rate_limit_counters"."hits" + 1
        END,
        "resetAt" = CASE
          WHEN "rate_limit_counters"."resetAt" <= NOW() THEN EXCLUDED."resetAt"
          ELSE "rate_limit_counters"."resetAt"
        END,
        "updatedAt" = NOW()
      RETURNING "hits" AS "totalHits", "resetAt" AS "resetTime"
    `;

    const result = rows[0];
    if (!result) throw new Error("RATE_LIMIT_COUNTER_WRITE_FAILED");

    this.operationCount += 1;
    if (this.operationCount % 512 === 0) {
      // Opportunistic bounded cleanup keeps old client-IP keys from growing
      // without running a timer in every API replica.
      void prisma.$executeRaw`
        DELETE FROM "rate_limit_counters"
        WHERE "key" IN (
          SELECT "key"
          FROM "rate_limit_counters"
          WHERE "resetAt" < NOW() - INTERVAL '1 hour'
          ORDER BY "resetAt" ASC
          LIMIT 500
        )
      `.catch((error) => {
        console.warn("Could not prune expired rate-limit counters", error);
      });
    }

    return result;
  }

  async decrement(key: string): Promise<void> {
    await prisma.$executeRaw`
      UPDATE "rate_limit_counters"
      SET "hits" = GREATEST("hits" - 1, 0), "updatedAt" = NOW()
      WHERE "key" = ${this.prefix + key}
    `;
  }

  async resetKey(key: string): Promise<void> {
    await prisma.$executeRaw`
      DELETE FROM "rate_limit_counters"
      WHERE "key" = ${this.prefix + key}
    `;
  }
}
