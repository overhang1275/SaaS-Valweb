ALTER TYPE "Role" ADD VALUE 'CONSULTATION_ONLY';

ALTER TABLE "User" DROP CONSTRAINT "User_role_tenant_check";
ALTER TABLE "User" ADD CONSTRAINT "User_role_tenant_check"
  CHECK (("role" = 'ADMIN' AND "tenantId" IS NULL) OR ("role" IN ('CLIENT', 'CONSULTATION_ONLY') AND "tenantId" IS NOT NULL));

CREATE UNIQUE INDEX "User_tenantId_id_key" ON "User"("tenantId", "id");

CREATE TABLE "UserValidationAccess" (
  "tenantId" UUID NOT NULL,
  "userId" UUID NOT NULL,
  "validationId" UUID NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "UserValidationAccess_pkey" PRIMARY KEY ("userId", "validationId")
);

CREATE INDEX "UserValidationAccess_tenantId_validationId_idx"
  ON "UserValidationAccess"("tenantId", "validationId");

ALTER TABLE "UserValidationAccess" ADD CONSTRAINT "UserValidationAccess_tenantId_userId_fkey"
  FOREIGN KEY ("tenantId", "userId") REFERENCES "User"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "UserValidationAccess" ADD CONSTRAINT "UserValidationAccess_tenantId_validationId_fkey"
  FOREIGN KEY ("tenantId", "validationId") REFERENCES "Validation"("tenantId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
