import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { normalizeAlfanum } from "@/features/records/alfanum";
import { createImageGrant, readImageGrant } from "./grants";
import { imageViewerHash, validViewerSecret } from "./viewer-session";
import { readImageFile } from "@/features/images/storage";

const available = { status: "ACTIVE" as const, deletedAt: null, tenant: { status: "ACTIVE" as const }, activeDataset: { status: "PUBLISHED" as const } };
export async function getPublicValidation(token: string) {
  if (!z.uuid().safeParse(token).success) return null;
  return prisma.validation.findFirst({ where: { ...available, publicToken: token }, select: { title: true, instructions: true } });
}
export async function verifyAlfanum(token: string, input: string, viewer: string) {
  const alfanumNormalized = normalizeAlfanum(input);
  if (!z.uuid().safeParse(token).success) return null;
  return prisma.$transaction(async tx => {
    const validation = await tx.validation.findFirst({ where: { ...available, publicToken: token } });
    if (!validation?.activeDatasetId) return null;
    const record = await tx.folio.findUnique({ where: { datasetId_alfanumNormalized: { datasetId: validation.activeDatasetId, alfanumNormalized } } });
    const date = new Date(new Date().toISOString().slice(0, 10));
    await tx.validationDailyStat.upsert({ where: { validationId_date: { validationId: validation.id, date } }, create: { tenantId: validation.tenantId, validationId: validation.id, date, found: record ? 1 : 0, notFound: record ? 0 : 1 }, update: record ? { found: { increment: 1 } } : { notFound: { increment: 1 } } });
    if (!record) return { found: false as const, message: validation.errorMessage };
    const fields: Array<{ label: string; value: string }> = [];
    if (validation.showFolio) fields.push({ label: "Folio", value: record.folio });
    if (validation.showAlfanum) fields.push({ label: "Alfanumérico", value: record.alfanum });
    if (validation.showTipo) fields.push({ label: "Tipo de documento", value: record.tipo ?? "—" });
    if (validation.showOtro) fields.push({ label: "Otros", value: record.otro ?? "—" });
    let image: { grant: string; alt: string; width: number; height: number } | null = null;
    if (validation.showImage) {
      const asset = validation.imageMode === "PER_RECORD" ? await tx.recordImage.findUnique({ where: { tenantId_validationId_alfanumNormalized: { tenantId: validation.tenantId, validationId: validation.id, alfanumNormalized } } }) : null;
      const storageKey = validation.imageMode === "PER_RECORD" ? asset?.storageKey : validation.imageKey;
      if (storageKey && validViewerSecret(viewer)) image = { grant: createImageGrant({ validationId: validation.id, datasetId: validation.activeDatasetId, imageId: asset?.id ?? null, storageKey, viewerHash: imageViewerHash(viewer) }), alt: validation.imageAlt, width: asset?.width ?? validation.imageWidth ?? 800, height: asset?.height ?? validation.imageHeight ?? 600 };
    }
    return { found: true as const, message: validation.successMessage, fields, image, imageUnavailable: validation.showImage && !image };
  });
}
export async function publicImage(token: string, viewer: string) {
  const grant = readImageGrant(token);
  if (!grant || !validViewerSecret(viewer) || grant.viewerHash !== imageViewerHash(viewer)) return null;
  const validation = await prisma.validation.findFirst({ where: { ...available, id: grant.validationId, activeDatasetId: grant.datasetId, showImage: true } });
  if (!validation) return null;
  if (validation.imageMode === "PER_RECORD") {
    if (!grant.imageId || !await prisma.recordImage.findFirst({ where: { id: grant.imageId, validationId: validation.id, tenantId: validation.tenantId, storageKey: grant.storageKey } })) return null;
  } else if (grant.imageId || validation.imageKey !== grant.storageKey) return null;
  try { return await readImageFile(grant.storageKey); } catch { return null; }
}
