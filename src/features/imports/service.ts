import { z } from "zod";
import { randomUUID } from "node:crypto";
import { prisma } from "@/lib/prisma";
import { currentActor, type Actor } from "@/features/identity/service";
import { lockValidation } from "@/features/validations/service";
import { enqueueImport } from "./queue";
import { lockImageLocation, removeImageFile } from "@/features/images/storage";
import { cleanupPublishedDirectoryOriginals } from "./directory";
import type { ImportJob, ImportKind } from "@/generated/prisma/client";

export const mappingSchema = z.object({ folio: z.string().min(1), alfanum: z.string().min(1), tipo: z.string().optional(), otro: z.string().optional() });
export function jobDto(job: ImportJob) {
  return { id: job.id, kind: job.kind, status: job.status, phase: job.phase, originalName: job.originalName, mode: job.mode, replaceImages: job.replaceImages, canPublish: job.status === "REVIEW" && Boolean(job.candidateDatasetId), canPublishImages: job.status === "REVIEW" && job.sourceKey.endsWith(".directory"), sourceType: job.sourceKey.endsWith(".directory") ? "DIRECTORY" : "UPLOAD", headers: job.headers, mapping: job.mapping, summary: job.summary, processed: job.processed, total: job.total, error: job.error, createdAt: job.createdAt.toISOString() };
}

export async function startDirectoryImport(actor: Actor, validationId: string) {
  z.uuid().parse(validationId);
  const job = await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const validation = await lockValidation(tx, user, validationId);
    if (validation.imageMode !== "PER_RECORD" || !validation.imageStorageKind) throw new Error("Selecciona almacenamiento por registro antes de procesar la carpeta.");
    await lockImageLocation(tx, validation.imageStorageKind);
    const active = await tx.importJob.findFirst({ where: { validationId, kind: "IMAGES", sourceKey: { endsWith: ".directory" }, status: { in: ["QUEUED", "PROCESSING", "REVIEW", "FAILED"] } } });
    if (active) throw new Error("Ya existe un análisis de carpeta pendiente. Revísalo o cancélalo antes de iniciar otro.");
    const id = randomUUID();
    return tx.importJob.create({ data: { id, tenantId: validation.tenantId, validationId, requestedById: user.id, kind: "IMAGES", imageStorageKind: validation.imageStorageKind, sourceKey: `${id}.directory`, originalName: "Actualización FTP", baseImageRevision: validation.imageRevision } });
  });
  try { await enqueueImport(job.id); }
  catch { await prisma.importJob.update({ where: { id: job.id }, data: { phase: "Pendiente de encolar. Usa reintentar." } }); }
  return prisma.importJob.findUniqueOrThrow({ where: { id: job.id } });
}
export async function listImports(actor: Actor, validationId: string, kind?: ImportKind) {
  z.enum(["CSV", "IMAGES"]).optional().parse(kind);
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    await lockValidation(tx, user, validationId);
    return (await tx.importJob.findMany({ where: { validationId, ...(kind ? { kind } : {}) }, orderBy: [{ createdAt: "desc" }, { id: "desc" }], take: 10 })).map(jobDto);
  });
}
export async function getImport(actor: Actor, id: string) {
  if (!z.uuid().safeParse(id).success) throw new Error("Importación no disponible.");
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const job = await tx.importJob.findUnique({ where: { id } });
    if (!job) throw new Error("Importación no disponible.");
    await lockValidation(tx, user, job.validationId);
    return job;
  });
}
export async function configureImport(actor: Actor, id: string, input: unknown) {
  const config = z.object({ mapping: mappingSchema, mode: z.enum(["REPLACE", "UPSERT"]) }).parse(input);
  await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const owner = await tx.importJob.findUniqueOrThrow({ where: { id }, select: { validationId: true } });
    await lockValidation(tx, user, owner.validationId);
    const job = await tx.importJob.findUniqueOrThrow({ where: { id } });
    if (job.kind !== "CSV" || job.status !== "REVIEW" || job.candidateDatasetId) throw new Error("Esta importación no admite cambios de mapeo.");
    const headers = z.array(z.string()).parse(job.headers);
    if (Object.values(config.mapping).some(value => value && !headers.includes(value))) throw new Error("Selecciona columnas del archivo recibido.");
    await tx.importJob.update({ where: { id }, data: { mapping: config.mapping, mode: config.mode, status: "QUEUED", phase: "En cola para validar", error: null } });
  });
  await enqueueImport(id);
}
export async function retryImport(actor: Actor, id: string, replaceImages = false) {
  await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const owner = await tx.importJob.findUniqueOrThrow({ where: { id }, select: { validationId: true } });
    await lockValidation(tx, user, owner.validationId);
    const job = await tx.importJob.findUniqueOrThrow({ where: { id } });
    if (job.status !== "FAILED" && job.status !== "QUEUED") throw new Error("La importación no se puede reintentar ahora.");
    if (job.sourceKey.endsWith(".directory") && replaceImages) throw new Error("La confirmación de reemplazos se realiza desde la revisión del análisis.");
    await tx.importJob.update({ where: { id }, data: { status: "QUEUED", phase: "Reintentando", error: null, ...(job.kind === "IMAGES" && replaceImages ? { replaceImages: true } : {}) } });
  });
  await enqueueImport(id);
}
export async function publishCsv(actor: Actor, id: string) {
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const owner = await tx.importJob.findUniqueOrThrow({ where: { id }, select: { validationId: true } });
    const validation = await lockValidation(tx, user, owner.validationId);
    const job = await tx.importJob.findUniqueOrThrow({ where: { id } });
    if (job.status !== "REVIEW" || !job.candidateDatasetId) throw new Error("La base aún no está lista para publicar.");
    if (job.baseDatasetId !== validation.activeDatasetId) throw new Error("La base cambió. Vuelve a importar para revisar los cambios actuales.");
    const candidate = await tx.dataset.findFirst({ where: { id: job.candidateDatasetId, tenantId: validation.tenantId, validationId: validation.id, status: "READY" } });
    if (!candidate || candidate.recordCount < 1n) throw new Error("La base no contiene registros válidos.");
    // Publishing a new base always requires a fresh activation decision.
    await tx.validation.update({ where: { id: validation.id }, data: { activeDatasetId: candidate.id, ...(validation.status === "ACTIVE" ? { status: "INACTIVE" } : {}) } });
    if (validation.activeDatasetId) await tx.dataset.update({ where: { id: validation.activeDatasetId }, data: { status: "RETIRED" } });
    await tx.dataset.update({ where: { id: candidate.id }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    await tx.importJob.update({ where: { id }, data: { status: "COMPLETED", phase: "Base publicada" } });
    await tx.auditLog.create({ data: { actorId: user.id, tenantId: validation.tenantId, targetId: validation.id, action: "CSV_PUBLISHED" } });
  });
}

export async function listImportReplacements(actor: Actor, validationId: string, id: string, page: number) {
  z.uuid().parse(validationId); z.uuid().parse(id); z.number().int().min(1).max(10000).parse(page);
  const job = await getImport(actor, id);
  if (job.validationId !== validationId || job.kind !== "IMAGES" || !job.sourceKey.endsWith(".directory")) throw new Error("La revisión no está disponible.");
  const where = { jobId: id, replacesImageId: { not: null } };
  const [total, rows] = await prisma.$transaction([prisma.importImageItem.count({ where }), prisma.importImageItem.findMany({ where, orderBy: { alfanumNormalized: "asc" }, skip: (page - 1) * 50, take: 50, select: { alfanumNormalized: true, originalName: true } })]);
  return { rows: rows.map(row => ({ alfanum: row.alfanumNormalized, originalName: row.originalName })), page, total, pageSize: 50 };
}

export async function publishDirectoryImport(actor: Actor, id: string) {
  const result = await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const job = await tx.importJob.findUniqueOrThrow({ where: { id } });
    const validation = await lockValidation(tx, user, job.validationId);
    if (job.kind !== "IMAGES" || !job.sourceKey.endsWith(".directory") || job.status !== "REVIEW") throw new Error("No hay una revisión de carpeta disponible.");
    if (validation.imageMode !== "PER_RECORD" || validation.imageStorageKind !== job.imageStorageKind || validation.imageRevision !== job.baseImageRevision) throw new Error("El catálogo o el destino cambió desde el análisis. Vuelve a procesar la carpeta.");
    const changed = await tx.$queryRaw<Array<{ valid: boolean }>>`SELECT bool_and((i."replacesImageId" IS NULL AND r.id IS NULL) OR (i."replacesImageId"=r.id)) AS valid FROM "ImportImageItem" i LEFT JOIN "RecordImage" r ON r."tenantId"=${job.tenantId}::uuid AND r."validationId"=${job.validationId}::uuid AND r."alfanumNormalized"=i."alfanumNormalized" WHERE i."jobId"=${id}::uuid`;
    if (!changed[0]?.valid) throw new Error("El catálogo cambió durante la revisión. Vuelve a procesar la carpeta.");
    const items = await tx.importImageItem.findMany({ where: { jobId: id } });
    const existingCount = await tx.recordImage.count({ where: { validationId: job.validationId } });
    const replacementCount = items.filter(item => item.replacesImageId).length;
    if (existingCount + items.length - replacementCount > 50000) throw new Error("La validación supera el máximo de 50,000 imágenes.");
    const old = await tx.$queryRaw<Array<{ storageKey: string }>>`SELECT r."storageKey" FROM "RecordImage" r JOIN "ImportImageItem" i ON i."replacesImageId"=r.id WHERE i."jobId"=${id}::uuid`;
    await tx.$executeRaw`INSERT INTO "RecordImage" (id,"tenantId","validationId","alfanumNormalized","originalName","storageKey",width,height,size,"sourceHash","createdAt","updatedAt") SELECT id,${job.tenantId}::uuid,${job.validationId}::uuid,"alfanumNormalized","originalName","storageKey",width,height,size,"sourceHash",now(),now() FROM "ImportImageItem" WHERE "jobId"=${id}::uuid ON CONFLICT ("tenantId","validationId","alfanumNormalized") DO UPDATE SET "originalName"=EXCLUDED."originalName","storageKey"=EXCLUDED."storageKey",width=EXCLUDED.width,height=EXCLUDED.height,size=EXCLUDED.size,"sourceHash"=EXCLUDED."sourceHash","updatedAt"=now()`;
    await tx.validation.update({ where: { id: job.validationId }, data: { imageRevision: { increment: 1 } } });
    await tx.importJob.update({ where: { id }, data: { status: "COMPLETED", phase: "Imágenes publicadas" } });
    await tx.auditLog.create({ data: { actorId: user.id, tenantId: job.tenantId, targetId: job.validationId, action: "DIRECTORY_IMAGES_PUBLISHED", metadata: { jobId: id, images: items.length } } });
    return { job, items, old: old.map(row => row.storageKey) };
  }, { timeout: 120000 });
  for (const key of result.old) await removeImageFile(key).catch(() => console.error("IMAGE_CLEANUP_FAILED"));
  const pending = await cleanupPublishedDirectoryOriginals(result.job);
  if (pending) await prisma.importJob.update({ where: { id }, data: { phase: `${pending} originales siguen pendientes de limpieza` } });
}

export async function cleanupDirectoryImport(actor: Actor, id: string) {
  const job = await getImport(actor, id);
  if (job.status !== "COMPLETED" || !job.sourceKey.endsWith(".directory")) throw new Error("No hay una limpieza pendiente.");
  const pending = await cleanupPublishedDirectoryOriginals(job);
  await prisma.importJob.update({ where: { id }, data: { phase: pending ? `${pending} originales siguen pendientes de limpieza` : "Imágenes publicadas; originales procesados" } });
}

export async function cancelImport(actor: Actor, id: string) {
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor); const job = await tx.importJob.findUniqueOrThrow({ where: { id } });
    await lockValidation(tx, user, job.validationId);
    await tx.importJob.updateMany({ where: { id, status: { in: ["QUEUED", "PROCESSING", "REVIEW", "FAILED"] } }, data: { status: "CANCELLED", phase: "Cancelada: base anterior conservada" } });
  });
}
