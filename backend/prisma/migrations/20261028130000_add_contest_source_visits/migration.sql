-- Record authenticated clicks from challenge source links for internal sponsor reporting.
CREATE TABLE "contest_source_visits" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "username" TEXT NOT NULL,
    "contestId" TEXT,
    "contestTitle" TEXT NOT NULL,
    "contestLanguage" TEXT NOT NULL,
    "contestStartsAt" TIMESTAMP(3),
    "clueId" TEXT,
    "clueSequence" INTEGER NOT NULL,
    "sourceUrl" TEXT NOT NULL,
    "sourceHostname" TEXT NOT NULL,
    "advertiserContentId" TEXT,
    "advertiserContentTitle" TEXT,
    "advertiserName" TEXT,
    "advertisementOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contest_source_visits_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contest_source_visits_createdAt_idx" ON "contest_source_visits"("createdAt");
CREATE INDEX "contest_source_visits_contestId_clueSequence_idx" ON "contest_source_visits"("contestId", "clueSequence");
CREATE INDEX "contest_source_visits_userId_createdAt_idx" ON "contest_source_visits"("userId", "createdAt");
CREATE INDEX "contest_source_visits_sourceHostname_createdAt_idx" ON "contest_source_visits"("sourceHostname", "createdAt");
CREATE INDEX "contest_source_visits_advertisementOrderId_createdAt_idx" ON "contest_source_visits"("advertisementOrderId", "createdAt");
CREATE UNIQUE INDEX "contest_source_visits_userId_clueId_key" ON "contest_source_visits"("userId", "clueId");

ALTER TABLE "contest_source_visits"
    ADD CONSTRAINT "contest_source_visits_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contest_source_visits"
    ADD CONSTRAINT "contest_source_visits_contestId_fkey"
    FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contest_source_visits"
    ADD CONSTRAINT "contest_source_visits_clueId_fkey"
    FOREIGN KEY ("clueId") REFERENCES "contest_clues"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contest_source_visits"
    ADD CONSTRAINT "contest_source_visits_advertiserContentId_fkey"
    FOREIGN KEY ("advertiserContentId") REFERENCES "advertiser_contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contest_source_visits"
    ADD CONSTRAINT "contest_source_visits_advertisementOrderId_fkey"
    FOREIGN KEY ("advertisementOrderId") REFERENCES "advertisement_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
