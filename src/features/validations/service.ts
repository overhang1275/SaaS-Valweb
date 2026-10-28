import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import { currentActor, type Actor } from '../identity/service';
import { removeImageFile } from '../images/storage';
import type { Prisma } from '../../generated/prisma/client';

const idSchema = z.uuid();
const texts = z.object({
  name: z.string().trim().min(1).max(120),
  title: z.string().trim().min(1).max(160),
  instructions: z.string().trim().max(2000),
  successMessage: z.string().trim().min(1).max(500),
  errorMessage: z.string().trim().min(1).max(500),
  imageAlt: z.string().trim().min(1).max(500).optional(),
  imageMode: z.enum(['SHARED', 'PER_RECORD']).optional(),
});
type Texts = z.input<typeof texts>;
const include = { tenant: { select: { name: true } } } as const;
const unavailable = () => new Error('La validación no está disponible.');
const scope = (user: { role: string; tenantId: string | null }): Prisma.ValidationWhereInput => ({ status: { not: 'DELETED' }, deletedAt: null, ...(user.role === 'ADMIN' ? {} : { tenantId: user.tenantId! }) });

export async function listValidations(actor: Actor) {
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    return tx.validation.findMany({ where: scope(user), include, orderBy: { createdAt: 'desc' } });
  });
}
export async function getValidation(actor: Actor, id: string) {
  idSchema.parse(id);
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    return tx.validation.findFirst({ where: { ...scope(user), id }, include });
  });
}
export async function getValidationStatistics(actor: Actor, id: string) {
  idSchema.parse(id);
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const row = await tx.validation.findFirst({
      where: { ...scope(user), id },
      select: { tenantId: true, activeDataset: { select: { id: true, status: true } } },
    });
    if (!row) return null;
    const where = { tenantId: row.tenantId, validationId: id };
    const [records, totals] = await Promise.all([
      row.activeDataset?.status === 'PUBLISHED' ? tx.folio.count({ where: { ...where, datasetId: row.activeDataset.id } }) : 0,
      tx.validationDailyStat.aggregate({ where, _sum: { found: true, notFound: true } }),
    ]);
    const found = totals._sum.found ?? 0n;
    const notFound = totals._sum.notFound ?? 0n;
    return { records, queries: found + notFound, found, notFound };
  }, { isolationLevel: 'RepeatableRead' });
}
export async function createValidation(actor: Actor, input: Texts & { tenantId?: string }) {
  const data = texts.parse(input);
  if (input.tenantId !== undefined) idSchema.parse(input.tenantId);
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    if (user.role === 'CLIENT' && input.tenantId !== undefined && input.tenantId !== user.tenantId) throw unavailable();
    const tenantId = user.role === 'ADMIN' ? input.tenantId : user.tenantId;
    if (!tenantId) throw new Error('Selecciona una cuenta activa.');
    const tenant = await tx.tenant.findFirst({ where: { id: tenantId, status: 'ACTIVE' } });
    if (!tenant) throw new Error('Selecciona una cuenta activa.');
    const row = await tx.validation.create({ data: { ...data, tenantId, createdById: user.id, publicToken: randomUUID() }, include });
    await tx.auditLog.create({ data: { actorId: user.id, tenantId, action: 'VALIDATION_CREATED', targetId: row.id } });
    return row;
  });
}
export async function updateValidation(actor: Actor, id: string, input: Texts) {
  idSchema.parse(id);
  const data = texts.parse(input);
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    await lockValidation(tx, user, id);
    const row = await tx.validation.update({ where: { id }, data, include });
    await tx.auditLog.create({ data: { actorId: user.id, tenantId: row.tenantId, action: 'VALIDATION_UPDATED', targetId: id } });
    return row;
  });
}
export async function deleteValidation(actor: Actor, id: string): Promise<void> {
  idSchema.parse(id);
  const keys = await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const row = await lockValidation(tx, user, id);
    const images = await tx.recordImage.findMany({ where: { validationId: id }, select: { storageKey: true } });
    await tx.recordImage.deleteMany({ where: { validationId: id } });
    await tx.importJob.updateMany({ where: { validationId: id, status: { in: ['QUEUED', 'PROCESSING', 'REVIEW'] } }, data: { status: 'CANCELLED', phase: 'Validación eliminada' } });
    await tx.validation.update({ where: { id }, data: { status: 'DELETED', deletedAt: new Date(), imageKey: null, imageMime: null, imageSize: null, imageWidth: null, imageHeight: null } });
    await tx.auditLog.create({ data: { actorId: user.id, tenantId: row.tenantId, action: 'VALIDATION_DELETED', targetId: id } });
    return [...(row.imageKey ? [row.imageKey] : []), ...images.map(image => image.storageKey)];
  });
  for (let offset = 0; offset < keys.length; offset += 16) {
    await Promise.all(keys.slice(offset, offset + 16).map(key => removeImageFile(key).catch(() => console.error('IMAGE_CLEANUP_FAILED'))));
  }
}

export async function lockValidation(tx: Prisma.TransactionClient, user: { role: string; tenantId: string | null }, id: string) {
  idSchema.parse(id);
  await tx.$queryRaw`SELECT id FROM "Validation" WHERE id = ${id}::uuid FOR UPDATE`;
  const row = await tx.validation.findFirst({ where: { ...scope(user), id }, include });
  if (!row) throw unavailable();
  return row;
}

async function readiness(tx: Prisma.TransactionClient, row: { id: string; tenantId: string; imageKey: string | null; activeDatasetId: string | null; imageMode: 'SHARED' | 'PER_RECORD'; showImage: boolean }) {
  const tenant = await tx.tenant.findUniqueOrThrow({ where: { id: row.tenantId } });
  const dataset = row.activeDatasetId ? await tx.dataset.findFirst({ where: { id: row.activeDatasetId, tenantId: row.tenantId, validationId: row.id, status: 'PUBLISHED' }, select: { id: true } }) : null;
  const folio = dataset ? await tx.folio.findFirst({ where: { tenantId: row.tenantId, validationId: row.id, datasetId: dataset.id }, select: { datasetId: true } }) : null;
  const imageCount = await tx.recordImage.count({ where: { tenantId: row.tenantId, validationId: row.id } });
  const missing = dataset ? await tx.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "Folio" f LEFT JOIN "RecordImage" i ON i."tenantId"=f."tenantId" AND i."validationId"=f."validationId" AND i."alfanumNormalized"=f."alfanumNormalized" WHERE f."datasetId"=${dataset.id}::uuid AND i.id IS NULL` : [{ count: 0n }];
  const missingImages = Number(missing[0].count);
  const hasImage = row.imageMode === 'SHARED' ? Boolean(row.imageKey) : Boolean(folio) && missingImages === 0;
  const hasFolios = Boolean(folio);
  const tenantActive = tenant.status === 'ACTIVE';
  return { hasImage, hasFolios, tenantActive, imageCount, missingImages, canActivate: (!row.showImage || hasImage) && hasFolios && tenantActive };
}

export async function getValidationReadiness(actor: Actor, id: string) {
  idSchema.parse(id);
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const row = await tx.validation.findFirst({ where: { ...scope(user), id } });
    return row ? readiness(tx, row) : null;
  });
}

export async function setValidationStatus(actor: Actor, id: string, status: 'ACTIVE' | 'INACTIVE') {
  idSchema.parse(id);
  z.enum(['ACTIVE', 'INACTIVE']).parse(status);
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const row = await lockValidation(tx, user, id);
    if (status === 'ACTIVE' && !(await readiness(tx, row)).canActivate) throw new Error('Para activar necesitas una cuenta activa, una imagen y folios publicados.');
    const updated = await tx.validation.update({ where: { id }, data: { status }, include });
    await tx.auditLog.create({ data: { actorId: user.id, tenantId: row.tenantId, action: `VALIDATION_${status}`, targetId: id } });
    return updated;
  });
}
