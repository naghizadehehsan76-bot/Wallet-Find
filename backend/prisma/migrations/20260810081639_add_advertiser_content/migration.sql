-- CreateEnum
CREATE TYPE "ClueSource" AS ENUM ('SYSTEM', 'ADVERTISER');

-- CreateEnum
CREATE TYPE "AdvertiserContentType" AS ENUM ('TEXT', 'LINK', 'FILE', 'IMAGE', 'PDF', 'AUDIO', 'VIDEO');

-- CreateEnum
CREATE TYPE "ContentProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'PROCESSED', 'FAILED');

-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'ADVERTISER';

-- AlterTable
ALTER TABLE "contest_clues" ADD COLUMN     "advertiserContentId" TEXT,
ADD COLUMN     "source" "ClueSource" NOT NULL DEFAULT 'SYSTEM';

-- CreateTable
CREATE TABLE "advertiser_contents" (
    "id" TEXT NOT NULL,
    "advertiserId" TEXT NOT NULL,
    "type" "AdvertiserContentType" NOT NULL,
    "title" TEXT,
    "description" TEXT,
    "url" TEXT,
    "fileName" TEXT,
    "filePath" TEXT,
    "mimeType" TEXT,
    "textContent" TEXT,
    "processingStatus" "ContentProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "processingError" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "advertiser_contents_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "advertiser_contents_advertiserId_idx" ON "advertiser_contents"("advertiserId");

-- CreateIndex
CREATE INDEX "advertiser_contents_processingStatus_idx" ON "advertiser_contents"("processingStatus");

-- CreateIndex
CREATE INDEX "contest_clues_source_idx" ON "contest_clues"("source");

-- CreateIndex
CREATE INDEX "contest_clues_advertiserContentId_idx" ON "contest_clues"("advertiserContentId");

-- CreateIndex
CREATE INDEX "users_role_idx" ON "users"("role");

-- AddForeignKey
ALTER TABLE "advertiser_contents" ADD CONSTRAINT "advertiser_contents_advertiserId_fkey" FOREIGN KEY ("advertiserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contest_clues" ADD CONSTRAINT "contest_clues_advertiserContentId_fkey" FOREIGN KEY ("advertiserContentId") REFERENCES "advertiser_contents"("id") ON DELETE SET NULL ON UPDATE CASCADE;
