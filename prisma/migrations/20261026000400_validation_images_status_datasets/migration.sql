-- CreateEnum
CREATE TYPE "DatasetStatus" AS ENUM ('BUILDING', 'READY', 'PUBLISHED', 'RETIRED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ValidationStatus" ADD VALUE 'ACTIVE';
ALTER TYPE "ValidationStatus" ADD VALUE 'INACTIVE';

-- AlterTable
ALTER TABLE "Validation" ADD COLUMN     "activeDatasetId" UUID,
ADD COLUMN     "imageAlt" VARCHAR(500) NOT NULL DEFAULT 'Resultado de la validación',
ADD COLUMN     "imageHeight" INTEGER,
ADD COLUMN     "imageKey" TEXT,
ADD COLUMN     "imageMime" TEXT,
ADD COLUMN     "imageSize" INTEGER,
ADD COLUMN     "imageWidth" INTEGER;

-- CreateTable
CREATE TABLE "Dataset" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "validationId" UUID NOT NULL,
    "status" "DatasetStatus" NOT NULL DEFAULT 'BUILDING',
    "recordCount" BIGINT NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "publishedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Dataset_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Folio" (
    "tenantId" UUID NOT NULL,
    "validationId" UUID NOT NULL,
    "datasetId" UUID NOT NULL,
    "folio" TEXT NOT NULL,
    "folioNormalized" VARCHAR(128) NOT NULL,
    "tipo" TEXT,
    "otro" TEXT,

    CONSTRAINT "Folio_pkey" PRIMARY KEY ("datasetId","folioNormalized")
);

-- CreateIndex
CREATE UNIQUE INDEX "Dataset_tenantId_validationId_id_key" ON "Dataset"("tenantId", "validationId", "id");

-- CreateIndex
CREATE INDEX "Folio_tenantId_validationId_datasetId_idx" ON "Folio"("tenantId", "validationId", "datasetId");

-- CreateIndex
CREATE UNIQUE INDEX "Validation_tenantId_id_key" ON "Validation"("tenantId", "id");

-- AddForeignKey
ALTER TABLE "Validation" ADD CONSTRAINT "Validation_tenantId_id_activeDatasetId_fkey" FOREIGN KEY ("tenantId", "id", "activeDatasetId") REFERENCES "Dataset"("tenantId", "validationId", "id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "Dataset" ADD CONSTRAINT "Dataset_tenantId_validationId_fkey" FOREIGN KEY ("tenantId", "validationId") REFERENCES "Validation"("tenantId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Folio" ADD CONSTRAINT "Folio_tenantId_validationId_datasetId_fkey" FOREIGN KEY ("tenantId", "validationId", "datasetId") REFERENCES "Dataset"("tenantId", "validationId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

