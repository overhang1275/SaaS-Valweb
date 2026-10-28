-- CreateEnum
CREATE TYPE "ImageMode" AS ENUM ('SHARED', 'PER_RECORD');

-- CreateEnum
CREATE TYPE "ImportKind" AS ENUM ('CSV', 'IMAGES');

-- CreateEnum
CREATE TYPE "ImportStatus" AS ENUM ('QUEUED', 'PROCESSING', 'REVIEW', 'COMPLETED', 'FAILED', 'CANCELLED');

-- AlterTable
ALTER TABLE "Folio" RENAME COLUMN "folioNormalized" TO "alfanumNormalized";
ALTER TABLE "Folio" ADD COLUMN "alfanum" TEXT;
UPDATE "Folio" SET "alfanum" = "alfanumNormalized";
ALTER TABLE "Folio" ALTER COLUMN "alfanum" SET NOT NULL;

-- AlterTable
ALTER TABLE "Validation" ADD COLUMN     "imageMode" "ImageMode" NOT NULL DEFAULT 'SHARED',
ADD COLUMN     "showAlfanum" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "showFolio" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showImage" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showOtro" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "showTipo" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "RecordImage" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "validationId" UUID NOT NULL,
    "alfanumNormalized" VARCHAR(128) NOT NULL,
    "originalName" VARCHAR(200) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RecordImage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportJob" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "validationId" UUID NOT NULL,
    "requestedById" UUID NOT NULL,
    "kind" "ImportKind" NOT NULL,
    "status" "ImportStatus" NOT NULL DEFAULT 'QUEUED',
    "phase" TEXT NOT NULL DEFAULT 'En cola',
    "sourceKey" TEXT NOT NULL,
    "originalName" VARCHAR(200) NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'REPLACE',
    "replaceImages" BOOLEAN NOT NULL DEFAULT false,
    "mapping" JSONB,
    "headers" JSONB,
    "summary" JSONB,
    "candidateDatasetId" UUID,
    "baseDatasetId" UUID,
    "total" INTEGER NOT NULL DEFAULT 0,
    "processed" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImportJob_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportImageItem" (
    "id" UUID NOT NULL,
    "jobId" UUID NOT NULL,
    "alfanumNormalized" VARCHAR(128) NOT NULL,
    "originalName" VARCHAR(200) NOT NULL,
    "storageKey" TEXT NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "size" INTEGER NOT NULL,

    CONSTRAINT "ImportImageItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValidationDailyStat" (
    "tenantId" UUID NOT NULL,
    "validationId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "found" BIGINT NOT NULL DEFAULT 0,
    "notFound" BIGINT NOT NULL DEFAULT 0,

    CONSTRAINT "ValidationDailyStat_pkey" PRIMARY KEY ("validationId","date")
);

-- CreateIndex
CREATE UNIQUE INDEX "RecordImage_storageKey_key" ON "RecordImage"("storageKey");

-- CreateIndex
CREATE INDEX "RecordImage_validationId_alfanumNormalized_idx" ON "RecordImage"("validationId", "alfanumNormalized");

-- CreateIndex
CREATE UNIQUE INDEX "RecordImage_tenantId_validationId_alfanumNormalized_key" ON "RecordImage"("tenantId", "validationId", "alfanumNormalized");

-- CreateIndex
CREATE INDEX "ImportJob_validationId_createdAt_idx" ON "ImportJob"("validationId", "createdAt");

-- CreateIndex
CREATE INDEX "ImportJob_status_updatedAt_idx" ON "ImportJob"("status", "updatedAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportImageItem_storageKey_key" ON "ImportImageItem"("storageKey");

-- CreateIndex
CREATE UNIQUE INDEX "ImportImageItem_jobId_alfanumNormalized_key" ON "ImportImageItem"("jobId", "alfanumNormalized");

-- AddForeignKey
ALTER TABLE "RecordImage" ADD CONSTRAINT "RecordImage_tenantId_validationId_fkey" FOREIGN KEY ("tenantId", "validationId") REFERENCES "Validation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_tenantId_validationId_fkey" FOREIGN KEY ("tenantId", "validationId") REFERENCES "Validation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportImageItem" ADD CONSTRAINT "ImportImageItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValidationDailyStat" ADD CONSTRAINT "ValidationDailyStat_tenantId_validationId_fkey" FOREIGN KEY ("tenantId", "validationId") REFERENCES "Validation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;


ALTER TABLE "Validation" ALTER COLUMN "imageMode" SET DEFAULT 'PER_RECORD';
