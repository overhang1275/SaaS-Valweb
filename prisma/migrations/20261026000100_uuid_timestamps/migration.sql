-- DropForeignKey
ALTER TABLE "User" DROP CONSTRAINT "User_tenantId_fkey";

-- DropForeignKey
ALTER TABLE "AccessToken" DROP CONSTRAINT "AccessToken_userId_fkey";

-- AlterTable
ALTER TABLE "Tenant" DROP CONSTRAINT "Tenant_pkey",
ADD COLUMN     "updatedAt" TIMESTAMPTZ(3) NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ADD CONSTRAINT "Tenant_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "User" DROP CONSTRAINT "User_pkey",
ADD COLUMN     "updatedAt" TIMESTAMPTZ(3) NOT NULL,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "tenantId",
ADD COLUMN     "tenantId" UUID,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ADD CONSTRAINT "User_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "AccessToken" DROP CONSTRAINT "AccessToken_pkey",
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "userId",
ADD COLUMN     "userId" UUID NOT NULL,
ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "usedAt" SET DATA TYPE TIMESTAMPTZ(3),
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ADD CONSTRAINT "AccessToken_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_pkey",
ADD COLUMN     "metadata" JSONB,
ADD COLUMN     "tenantId" UUID,
DROP COLUMN "id",
ADD COLUMN     "id" UUID NOT NULL,
DROP COLUMN "actorId",
ADD COLUMN     "actorId" UUID,
DROP COLUMN "targetId",
ADD COLUMN     "targetId" UUID,
ALTER COLUMN "createdAt" SET DATA TYPE TIMESTAMPTZ(3),
ADD CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id");

-- AlterTable
ALTER TABLE "RateLimitBucket" ALTER COLUMN "expiresAt" SET DATA TYPE TIMESTAMPTZ(3);

-- CreateIndex
CREATE INDEX "User_tenantId_idx" ON "User"("tenantId");

-- CreateIndex
CREATE INDEX "AccessToken_userId_purpose_idx" ON "AccessToken"("userId", "purpose");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccessToken" ADD CONSTRAINT "AccessToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

