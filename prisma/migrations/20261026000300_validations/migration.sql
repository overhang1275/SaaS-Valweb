-- CreateEnum
CREATE TYPE "ValidationStatus" AS ENUM ('DRAFT', 'DELETED');

-- CreateTable
CREATE TABLE "Validation" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "createdById" UUID NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "title" VARCHAR(160) NOT NULL,
    "instructions" VARCHAR(2000) NOT NULL,
    "successMessage" VARCHAR(500) NOT NULL,
    "errorMessage" VARCHAR(500) NOT NULL,
    "publicToken" UUID NOT NULL,
    "status" "ValidationStatus" NOT NULL DEFAULT 'DRAFT',
    "deletedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Validation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Validation_publicToken_key" ON "Validation"("publicToken");

-- CreateIndex
CREATE INDEX "Validation_tenantId_status_createdAt_idx" ON "Validation"("tenantId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "Validation_createdById_idx" ON "Validation"("createdById");

-- AddForeignKey
ALTER TABLE "Validation" ADD CONSTRAINT "Validation_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Validation" ADD CONSTRAINT "Validation_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

