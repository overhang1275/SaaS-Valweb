ALTER TABLE "User" ADD CONSTRAINT "User_role_tenant_check" CHECK (("role" = 'ADMIN' AND "tenantId" IS NULL) OR ("role" = 'CLIENT' AND "tenantId" IS NOT NULL));
CREATE INDEX "AccessToken_expiresAt_idx" ON "AccessToken"("expiresAt");
CREATE INDEX "RateLimitBucket_expiresAt_idx" ON "RateLimitBucket"("expiresAt");
CREATE INDEX "AuditLog_tenantId_createdAt_idx" ON "AuditLog"("tenantId", "createdAt");
