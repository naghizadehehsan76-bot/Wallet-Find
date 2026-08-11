-- CreateEnum
CREATE TYPE "AdvertisementStatus" AS ENUM ('DRAFT', 'PENDING_PAYMENT', 'ACTIVE', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PAID', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "AdvertisementMetricType" AS ENUM ('VIEW', 'CLICK', 'PARTICIPATION');

-- CreateTable
CREATE TABLE "advertisement_orders" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "contentId" TEXT NOT NULL,
    "contestId" TEXT,
    "status" "AdvertisementStatus" NOT NULL DEFAULT 'DRAFT',
    "basePrice" INTEGER NOT NULL,
    "participantPrice" INTEGER NOT NULL DEFAULT 0,
    "viewPrice" INTEGER NOT NULL DEFAULT 0,
    "totalPrice" INTEGER NOT NULL,
    "targetParticipants" INTEGER,
    "targetViews" INTEGER,
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertisement_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisement_payments" (
    "id" TEXT NOT NULL,
    "advertisementOrderId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "provider" TEXT,
    "transactionId" TEXT,
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertisement_payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisement_pricing" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "basePrice" INTEGER NOT NULL,
    "participantUnit" INTEGER NOT NULL DEFAULT 100,
    "participantPrice" INTEGER NOT NULL DEFAULT 0,
    "viewUnit" INTEGER NOT NULL DEFAULT 1000,
    "viewPrice" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertisement_pricing_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "advertisement_metrics" (
    "id" TEXT NOT NULL,
    "advertisementOrderId" TEXT NOT NULL,
    "type" "AdvertisementMetricType" NOT NULL,
    "value" INTEGER NOT NULL DEFAULT 1,
    "ipHash" TEXT,
    "userId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "advertisement_metrics_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advertisement_orders_advertiserId_idx" ON "advertisement_orders"("advertiserId");

-- CreateIndex
CREATE INDEX "advertisement_orders_contentId_idx" ON "advertisement_orders"("contentId");

-- CreateIndex
CREATE INDEX "advertisement_orders_contestId_idx" ON "advertisement_orders"("contestId");

-- CreateIndex
CREATE INDEX "advertisement_orders_status_idx" ON "advertisement_orders"("status");

-- CreateIndex
CREATE INDEX "advertisement_orders_startsAt_idx" ON "advertisement_orders"("startsAt");

-- CreateIndex
CREATE INDEX "advertisement_orders_endsAt_idx" ON "advertisement_orders"("endsAt");

-- CreateIndex
CREATE INDEX "advertisement_payments_advertisementOrderId_idx" ON "advertisement_payments"("advertisementOrderId");

-- CreateIndex
CREATE INDEX "advertisement_payments_status_idx" ON "advertisement_payments"("status");

-- CreateIndex
CREATE INDEX "advertisement_payments_transactionId_idx" ON "advertisement_payments"("transactionId");

-- CreateIndex
CREATE INDEX "advertisement_pricing_isActive_idx" ON "advertisement_pricing"("isActive");

-- CreateIndex
CREATE INDEX "advertisement_metrics_advertisementOrderId_idx" ON "advertisement_metrics"("advertisementOrderId");

-- CreateIndex
CREATE INDEX "advertisement_metrics_type_idx" ON "advertisement_metrics"("type");

-- CreateIndex
CREATE INDEX "advertisement_metrics_createdAt_idx" ON "advertisement_metrics"("createdAt");

-- CreateIndex
CREATE INDEX "advertisement_metrics_userId_idx" ON "advertisement_metrics"("userId");

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisement_orders" ADD CONSTRAINT "advertisement_orders_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisement_orders" ADD CONSTRAINT "advertisement_orders_contentId_fkey" FOREIGN KEY ("contentId") REFERENCES "advertiser_contents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisement_orders" ADD CONSTRAINT "advertisement_orders_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisement_payments" ADD CONSTRAINT "advertisement_payments_advertisementOrderId_fkey" FOREIGN KEY ("advertisementOrderId") REFERENCES "advertisement_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "advertisement_metrics" ADD CONSTRAINT "advertisement_metrics_advertisementOrderId_fkey" FOREIGN KEY ("advertisementOrderId") REFERENCES "advertisement_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;
