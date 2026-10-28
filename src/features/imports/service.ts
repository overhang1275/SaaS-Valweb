import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentActor, type Actor } from "@/features/identity/service";
import { lockValidation } from "@/features/validations/service";
import { enqueueImport } from "./queue";
import type { ImportJob } from "@/generated/prisma/client";

export const mappingSchema = z.object({ folio: z.string().min(1), alfanum: z.string().min(1), tipo: z.string().optional(), otro: z.string().optional() });
export function jobDto(job: ImportJob) {
  return { id: job.id, kind: job.kind, status: job.status, phase: job.phase, originalName: job.originalName, mode: job.mode, replaceImages: job.replaceImages, canPublish: job.status === "REVIEW" && Boolean(job.candidateDatasetId), headers: job.headers, mapping: job.mapping, summary: job.summary, processed: job.processed, total: job.total, error: job.error, createdAt: job.createdAt.toISOString() };
}
export async function listImports(actor: Actor, validationId: string) {
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    await lockValidation(tx, user, validationId);
    return (await tx.importJob.findMany({ where: { validationId }, orderBy: { createdAt: "desc" }, take: 10 })).map(jobDto);
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

export async function cancelImport(actor: Actor, id: string) {
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor); const job = await tx.importJob.findUniqueOrThrow({ where: { id } });
    await lockValidation(tx, user, job.validationId);
    await tx.importJob.updateMany({ where: { id, status: { in: ["QUEUED", "PROCESSING", "REVIEW"] } }, data: { status: "CANCELLED", phase: "Cancelada: base anterior conservada" } });
  });
}
