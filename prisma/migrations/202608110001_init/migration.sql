-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "KeyStatus" AS ENUM ('ACTIVE', 'PURGED');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('DRAFT', 'PROCESSING', 'COMPLETED', 'COMPLETED_WITH_ERRORS', 'FAILED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('LIGHTNING_ADDRESS', 'INTRA_LEDGER');

-- CreateEnum
CREATE TYPE "RecipientStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCESS', 'FAILED');

-- CreateTable
CREATE TABLE "Institution" (
    "id" VARCHAR(64) NOT NULL,
    "blinkUserId" VARCHAR(128) NOT NULL,
    "blinkUsername" VARCHAR(128),
    "walletId" VARCHAR(128) NOT NULL,
    "walletCurrency" VARCHAR(8) NOT NULL DEFAULT 'BTC',
    "balanceSnapshot" BIGINT,
    "keyCiphertext" TEXT,
    "keyIv" VARCHAR(32),
    "keyAuthTag" VARCHAR(32),
    "keyStatus" "KeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "keyVersion" INTEGER NOT NULL DEFAULT 1,
    "keyVerifiedAt" TIMESTAMP(3),
    "keyPurgedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Institution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "tokenHash" CHAR(64) NOT NULL,
    "institutionId" VARCHAR(64) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Batch" (
    "id" TEXT NOT NULL,
    "institutionId" VARCHAR(64) NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'DRAFT',
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'LIGHTNING_ADDRESS',
    "recipientsTotal" INTEGER NOT NULL,
    "totalAmount" BIGINT NOT NULL,
    "successfulPayments" INTEGER NOT NULL DEFAULT 0,
    "failedPayments" INTEGER NOT NULL DEFAULT 0,
    "errorMessage" TEXT,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "keyPurgedAt" TIMESTAMP(3),
    "keyVersionUsed" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Batch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BatchRecipient" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "address" VARCHAR(254) NOT NULL,
    "amount" INTEGER NOT NULL,
    "memo" VARCHAR(200) NOT NULL,
    "status" "RecipientStatus" NOT NULL DEFAULT 'PENDING',
    "blinkStatus" VARCHAR(64),
    "transactionId" VARCHAR(128),
    "errorCode" VARCHAR(64),
    "errorMessage" TEXT,
    "processedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BatchRecipient_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "institutionId" VARCHAR(64) NOT NULL,
    "batchId" TEXT,
    "type" VARCHAR(64) NOT NULL,
    "details" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Institution_blinkUserId_idx" ON "Institution"("blinkUserId");

-- CreateIndex
CREATE INDEX "Institution_keyStatus_idx" ON "Institution"("keyStatus");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_institutionId_idx" ON "Session"("institutionId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Batch_institutionId_createdAt_idx" ON "Batch"("institutionId", "createdAt");

-- CreateIndex
CREATE INDEX "Batch_status_idx" ON "Batch"("status");

-- CreateIndex
CREATE INDEX "BatchRecipient_batchId_status_idx" ON "BatchRecipient"("batchId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "BatchRecipient_batchId_rowNumber_key" ON "BatchRecipient"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "AuditEvent_institutionId_createdAt_idx" ON "AuditEvent"("institutionId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_batchId_idx" ON "AuditEvent"("batchId");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Batch" ADD CONSTRAINT "Batch_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BatchRecipient" ADD CONSTRAINT "BatchRecipient_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_institutionId_fkey" FOREIGN KEY ("institutionId") REFERENCES "Institution"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "Batch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

