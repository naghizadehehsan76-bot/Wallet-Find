-- CreateEnum
CREATE TYPE "ContestStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'ACTIVE', 'FINISHED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ClueType" AS ENUM ('TEXT', 'IMAGE', 'PDF', 'AUDIO', 'VIDEO', 'WEB_PAGE');

-- CreateTable
CREATE TABLE "contests" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "status" "ContestStatus" NOT NULL DEFAULT 'DRAFT',
    "startsAt" TIMESTAMP(3),
    "endsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contest_clues" (
    "id" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "type" "ClueType" NOT NULL DEFAULT 'TEXT',
    "content" TEXT NOT NULL,
    "correctAnswer" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "contest_clues_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submissions" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "contestId" TEXT NOT NULL,
    "clueId" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "isCorrect" BOOLEAN NOT NULL DEFAULT false,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "responseTimeMs" BIGINT,

    CONSTRAINT "submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "contests_status_idx" ON "contests"("status");

-- CreateIndex
CREATE INDEX "contests_startsAt_idx" ON "contests"("startsAt");

-- CreateIndex
CREATE INDEX "contest_clues_contestId_idx" ON "contest_clues"("contestId");

-- CreateIndex
CREATE INDEX "contest_clues_publishedAt_idx" ON "contest_clues"("publishedAt");

-- CreateIndex
CREATE UNIQUE INDEX "contest_clues_contestId_sequence_key" ON "contest_clues"("contestId", "sequence");

-- CreateIndex
CREATE INDEX "submissions_userId_contestId_idx" ON "submissions"("userId", "contestId");

-- CreateIndex
CREATE INDEX "submissions_contestId_clueId_idx" ON "submissions"("contestId", "clueId");

-- CreateIndex
CREATE INDEX "submissions_contestId_userId_idx" ON "submissions"("contestId", "userId");

-- AddForeignKey
ALTER TABLE "contest_clues" ADD CONSTRAINT "contest_clues_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_contestId_fkey" FOREIGN KEY ("contestId") REFERENCES "contests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_clueId_fkey" FOREIGN KEY ("clueId") REFERENCES "contest_clues"("id") ON DELETE CASCADE ON UPDATE CASCADE;
