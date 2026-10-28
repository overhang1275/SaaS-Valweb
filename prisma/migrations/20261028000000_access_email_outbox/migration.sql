CREATE TABLE "AccessEmailOutbox" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "recipient" VARCHAR(254) NOT NULL,
    "purpose" "TokenPurpose" NOT NULL,
    "accessTokenId" UUID,
    "encryptedToken" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "nextAttemptAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lockedAt" TIMESTAMPTZ(3),
    "lastErrorCode" VARCHAR(80),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "AccessEmailOutbox_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AccessEmailOutbox_accessTokenId_key" ON "AccessEmailOutbox"("accessTokenId");
CREATE INDEX "AccessEmailOutbox_nextAttemptAt_lockedAt_createdAt_idx" ON "AccessEmailOutbox"("nextAttemptAt", "lockedAt", "createdAt");
ALTER TABLE "AccessEmailOutbox" ADD CONSTRAINT "AccessEmailOutbox_accessTokenId_fkey" FOREIGN KEY ("accessTokenId") REFERENCES "AccessToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;
