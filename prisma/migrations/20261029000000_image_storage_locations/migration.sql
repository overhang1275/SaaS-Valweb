CREATE TYPE "StorageKind" AS ENUM ('LOCAL', 'NFS');

CREATE TABLE "ImageStorageLocation" (
    "kind" "StorageKind" NOT NULL,
    "rootPath" TEXT NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ImageStorageLocation_pkey" PRIMARY KEY ("kind")
);
