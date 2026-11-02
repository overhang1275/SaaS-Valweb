CREATE TABLE "SmtpSettings" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "host" VARCHAR(253) NOT NULL,
    "port" INTEGER NOT NULL,
    "from" VARCHAR(320) NOT NULL,
    "user" VARCHAR(254) NOT NULL,
    "encryptedPassword" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "SmtpSettings_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "SmtpSettings_singleton" CHECK ("id" = 1)
);
