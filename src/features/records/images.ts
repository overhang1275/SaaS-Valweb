import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentActor, type Actor } from "@/features/identity/service";
import { getValidation, lockValidation } from "@/features/validations/service";
import { removeImageFile, writeImageFile, imageTarget } from "@/features/images/storage";
import { prepareImage } from "@/features/images/processing";
import { ImageError } from "@/features/images/limits";
import { Prisma } from "@/generated/prisma/client";
import { catalogQuerySchema, DEFAULT_CATALOG_QUERY, type CatalogQuery, type CatalogRow } from "./catalog-query";

type RawCatalogRow = Omit<CatalogRow, "image"> & {
  imageId: string | null; originalName: string | null; width: number | null; height: number | null;
  size: number | null; createdAt: Date | null; updatedAt: Date | null;
};

export async function recordImagePreview(actor: Actor, validationId: string) {
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const validation = await lockValidation(tx, user, validationId);
    const where = { tenantId: validation.tenantId, validationId };
    const [rows, total] = await Promise.all([
      tx.recordImage.findMany({ where, orderBy: { alfanumNormalized: "asc" }, take: 4,
        select: { id: true, alfanumNormalized: true, originalName: true, width: true, height: true, updatedAt: true } }),
      tx.recordImage.count({ where }),
    ]);
    return { rows, total };
  }, { isolationLevel: "RepeatableRead" });
}

export async function listRecordImages(actor: Actor, validationId: string, options: CatalogQuery = DEFAULT_CATALOG_QUERY) {
  const query = catalogQuerySchema.parse(options);
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const validation = await lockValidation(tx, user, validationId);
    const dataset = validation.activeDatasetId ? await tx.dataset.findFirst({ where: {
      id: validation.activeDatasetId, validationId, tenantId: validation.tenantId, status: "PUBLISHED",
    }, select: { id: true } }) : null;
    const source = Prisma.sql`WITH catalog AS (
      SELECT COALESCE(i.id::text, f."datasetId"::text || ':' || f."alfanumNormalized") AS key,
        COALESCE(f.alfanum, i."alfanumNormalized") AS alfanum,
        COALESCE(f."alfanumNormalized", i."alfanumNormalized") AS normalized,
        f.folio, f.tipo,
        CASE WHEN i.id IS NULL THEN 'missing' WHEN f."datasetId" IS NULL THEN 'orphan' ELSE 'linked' END AS state,
        i.id AS "imageId", i."originalName", i.width, i.height, i.size, i."createdAt", i."updatedAt"
      FROM (SELECT * FROM "Folio" WHERE "tenantId"=${validation.tenantId}::uuid
        AND "validationId"=${validationId}::uuid AND "datasetId"=${dataset?.id ?? null}::uuid) f
      FULL OUTER JOIN (SELECT * FROM "RecordImage" WHERE "tenantId"=${validation.tenantId}::uuid
        AND "validationId"=${validationId}::uuid) i ON i."alfanumNormalized"=f."alfanumNormalized"
    )`;
    const conditions: Prisma.Sql[] = [];
    if (query.state !== "all") conditions.push(Prisma.sql`state=${query.state}`);
    if (query.tipo) conditions.push(Prisma.sql`tipo=${query.tipo}`);
    if (query.search) {
      if (query.searchBy === "alfanum") conditions.push(Prisma.sql`starts_with(normalized, ${query.search.toUpperCase()})`);
      else if (query.searchBy === "folio") conditions.push(Prisma.sql`starts_with(folio, ${query.search})`);
      else conditions.push(Prisma.sql`starts_with(lower("originalName"), ${query.search.toLowerCase()})`);
    }
    // Date-only filters use the customer's timezone, including its historical daylight-saving rules.
    if (query.from) conditions.push(Prisma.sql`"createdAt">=(${query.from}::date::timestamp AT TIME ZONE 'America/Mexico_City')`);
    if (query.until) conditions.push(Prisma.sql`"createdAt"<(((${query.until}::date)+1)::timestamp AT TIME ZONE 'America/Mexico_City')`);
    const filter = conditions.length ? Prisma.sql`WHERE ${Prisma.join(conditions, " AND ")}` : Prisma.empty;
    const counts = await tx.$queryRaw<Array<{ count: bigint }>>(Prisma.sql`${source} SELECT count(*) FROM catalog ${filter}`);
    const total = Number(counts[0].count);
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const raw = await tx.$queryRaw<RawCatalogRow[]>(Prisma.sql`${source} SELECT key, alfanum, folio, tipo, state,
      "imageId", "originalName", width, height, size, "createdAt", "updatedAt" FROM catalog ${filter}
      ORDER BY normalized COLLATE "C", key LIMIT ${query.pageSize} OFFSET ${(page - 1) * query.pageSize}`);
    const types = dataset ? await tx.$queryRaw<Array<{ tipo: string }>>`SELECT DISTINCT tipo FROM "Folio"
      WHERE "tenantId"=${validation.tenantId}::uuid AND "validationId"=${validationId}::uuid
      AND "datasetId"=${dataset.id}::uuid AND tipo IS NOT NULL AND tipo<>'' ORDER BY tipo` : [];
    const rows: CatalogRow[] = raw.map(row => ({ key: row.key, alfanum: row.alfanum, folio: row.folio, tipo: row.tipo, state: row.state,
      image: row.imageId ? { id: row.imageId, originalName: row.originalName!, width: row.width!, height: row.height!,
        size: row.size!, createdAt: row.createdAt!, updatedAt: row.updatedAt! } : null,
    }));
    return { rows, total, page, pageSize: query.pageSize, types: types.flatMap(row => row.tipo ? [row.tipo] : []) };
  }, { isolationLevel: "RepeatableRead" });
}
export async function getRecordImage(actor: Actor, validationId: string, id: string) {
  z.uuid().parse(id);
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    await lockValidation(tx, user, validationId);
    return tx.recordImage.findFirst({ where: { id, validationId } });
  });
}
export async function deleteRecordImage(actor: Actor, validationId: string, id: string, confirmed: boolean) {
  const key = await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor, true);
    const validation = await lockValidation(tx, user, validationId);
    if (await tx.importJob.findFirst({ where: { validationId, status: "REVIEW", sourceKey: { endsWith: ".directory" } } })) throw new ImageError(409, "Confirma o cancela la revisión de imágenes antes de cambiar el catálogo.");
    const image = await tx.recordImage.findFirst({ where: { id, validationId } });
    if (!image) throw new ImageError(404, "La imagen no está disponible.");
    if (validation.status === "ACTIVE" && validation.showImage && validation.imageMode === "PER_RECORD" && !confirmed) throw new ImageError(409, "Confirma la desactivación antes de eliminar una imagen de esta validación activa.");
    if (validation.status === "ACTIVE" && validation.showImage && validation.imageMode === "PER_RECORD") await tx.validation.update({ where: { id: validationId }, data: { status: "INACTIVE" } });
    await tx.recordImage.delete({ where: { id } });
    await tx.validation.update({ where: { id: validationId }, data: { imageRevision: { increment: 1 } } });
    await tx.auditLog.create({ data: { actorId: user.id, tenantId: validation.tenantId, targetId: validationId, action: "RECORD_IMAGE_DELETED" } });
    return image.storageKey;
  });
  await removeImageFile(key).catch(() => console.error("IMAGE_CLEANUP_FAILED"));
}

export async function replaceRecordImage(actor: Actor, validationId: string, id: string, input: Buffer, filename: string, mime: string, version: string) {
  if (actor.role !== "ADMIN") throw new ImageError(403, "Solo un administrador puede cargar imágenes.");
  const expected = z.iso.datetime({ offset: true }).safeParse(version);
  if (!expected.success) throw new ImageError(400, "La versión de la imagen no es válida. Recarga el catálogo.");
  const owner = await getValidation(actor, validationId);
  if (!owner) throw new ImageError(404, "La validación no está disponible.");
  const existing = await getRecordImage(actor, validationId, id);
  if (!existing) throw new ImageError(404, "La imagen no está disponible.");
  if (existing.updatedAt.getTime() !== new Date(version).getTime()) throw new ImageError(409, "La imagen cambió. Recarga el catálogo antes de reemplazarla.");
  const prepared = await prepareImage(input, filename, mime);
  const key = await writeImageFile(prepared.data, imageTarget(owner));
  let previous: string;
  try {
    previous = await prisma.$transaction(async tx => {
      const user = await currentActor(tx, actor, true);
      const validation = await lockValidation(tx, user, validationId);
      if (await tx.importJob.findFirst({ where: { validationId, status: "REVIEW", sourceKey: { endsWith: ".directory" } } })) throw new ImageError(409, "Confirma o cancela la revisión de imágenes antes de cambiar el catálogo.");
      if (validation.imageStorageKind !== owner.imageStorageKind) throw new ImageError(409, "El destino de imágenes cambió. Vuelve a cargar la imagen.");
      const image = await tx.recordImage.findFirst({ where: { id, tenantId: validation.tenantId, validationId } });
      if (!image) throw new ImageError(404, "La imagen no está disponible.");
      if (image.storageKey !== existing.storageKey || image.updatedAt.getTime() !== new Date(version).getTime()) {
        throw new ImageError(409, "La imagen cambió. Recarga el catálogo antes de reemplazarla.");
      }
      await tx.recordImage.update({ where: { id }, data: {
        storageKey: key, originalName: filename, width: prepared.width, height: prepared.height, size: prepared.data.length,
        sourceHash: null,
        updatedAt: new Date(Math.max(Date.now(), image.updatedAt.getTime() + 1)),
      } });
      await tx.validation.update({ where: { id: validationId }, data: { imageRevision: { increment: 1 } } });
      await tx.auditLog.create({ data: { actorId: user.id, tenantId: validation.tenantId, targetId: validationId,
        action: "RECORD_IMAGE_REPLACED", metadata: { imageId: id } } });
      return image.storageKey;
    });
  } catch (cause) {
    // Preserve a committed file when the connection loses the commit acknowledgement.
    try {
      if (!await prisma.recordImage.findFirst({ where: { storageKey: key }, select: { id: true } })) await removeImageFile(key);
    } catch { console.error("IMAGE_ORPHAN_RETAINED"); }
    throw cause;
  }
  await removeImageFile(previous).catch(() => console.error("IMAGE_CLEANUP_FAILED"));
}
