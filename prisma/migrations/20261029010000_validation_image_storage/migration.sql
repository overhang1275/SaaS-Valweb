ALTER TABLE "Validation" ADD COLUMN "imageStorageKind" "StorageKind";

ALTER TABLE "Validation" ADD CONSTRAINT "Validation_imageStorageKind_fkey"
    FOREIGN KEY ("imageStorageKind") REFERENCES "ImageStorageLocation"("kind")
    ON DELETE RESTRICT ON UPDATE RESTRICT;
