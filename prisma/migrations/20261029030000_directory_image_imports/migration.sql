ALTER TABLE "Validation" ADD COLUMN "imageRevision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ImportJob" ADD COLUMN "baseImageRevision" INTEGER;
ALTER TABLE "ImportImageItem" ADD COLUMN "sourceHash" VARCHAR(64), ADD COLUMN "replacesImageId" UUID;
ALTER TABLE "RecordImage" ADD COLUMN "sourceHash" VARCHAR(64);
