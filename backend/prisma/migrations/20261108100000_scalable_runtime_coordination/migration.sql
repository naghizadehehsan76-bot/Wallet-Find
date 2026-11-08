CREATE TABLE "system_job_leases" (
    "name" TEXT NOT NULL,
    "owner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "heartbeatAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "system_job_leases_pkey" PRIMARY KEY ("name")
);

CREATE INDEX "system_job_leases_leaseExpiresAt_idx"
ON "system_job_leases"("leaseExpiresAt");

CREATE TABLE "rate_limit_counters" (
    "key" TEXT NOT NULL,
    "hits" INTEGER NOT NULL,
    "resetAt" TIMESTAMP(3) NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "rate_limit_counters_pkey" PRIMARY KEY ("key")
);

CREATE INDEX "rate_limit_counters_resetAt_idx"
ON "rate_limit_counters"("resetAt");

CREATE INDEX "submissions_contestId_submittedAt_idx"
ON "submissions"("contestId", "submittedAt");
