CREATE TABLE "turnkey_webhook_events" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "organizationId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'RECEIVED',
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "processingError" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "turnkey_webhook_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "turnkey_webhook_events_eventId_key" ON "turnkey_webhook_events"("eventId");
CREATE INDEX "turnkey_webhook_events_status_receivedAt_idx" ON "turnkey_webhook_events"("status", "receivedAt");
CREATE INDEX "turnkey_webhook_events_organizationId_receivedAt_idx" ON "turnkey_webhook_events"("organizationId", "receivedAt");
