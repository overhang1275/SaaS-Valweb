import { mkdir, rm, readFile, statfs } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { join, basename, extname, isAbsolute } from "node:path";
import { randomUUID } from "node:crypto";
import { pipeline } from "node:stream/promises";
import { DuckDBInstance } from "@duckdb/node-api";
import { Client } from "pg";
import { from as copyFrom } from "pg-copy-streams";
import { openPromise } from "yauzl";
import { ZodError } from "zod";
import { prisma } from "@/lib/prisma";
import { currentActor } from "@/features/identity/service";
import { lockValidation } from "@/features/validations/service";
import { imageAlfanum } from "@/features/records/alfanum";
import { prepareImage } from "@/features/images/processing";
import { writeImageFile, removeImageFile } from "@/features/images/storage";
import { ImageError, MAX_IMAGE_BYTES } from "@/features/images/limits";
import { importRoot, sourcePath } from "./files";
import { mappingSchema } from "./service";
import { inspectImageArchive, MAX_EXPANDED_BYTES } from "./archive";
import { captureDirectoryImport, cleanupPublishedDirectoryOriginals, readDirectorySnapshot, readDirectorySnapshotFile } from "./directory";
import type { ImportJob, Prisma } from "@/generated/prisma/client";

class ImportError extends Error {}
const literal = (text: string) => `'${text.replaceAll("'", "''")}'`;
const identifier = (text: string) => `"${text.replaceAll('"', '""')}"`;

async function actorFor(job: ImportJob) {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: job.requestedById } });
  if (user.status !== "ACTIVE" || (user.role !== "ADMIN" && user.tenantId !== job.tenantId)) throw new ImportError("El solicitante ya no tiene acceso a esta cuenta.");
  return { id: user.id, role: user.role, tenantId: user.tenantId, sessionVersion: user.sessionVersion };
}
async function updateProgress(id: string, data: Prisma.ImportJobUpdateManyMutationInput) {
  const result = await prisma.importJob.updateMany({ where: { id, status: "PROCESSING" }, data });
  if (!result.count) throw new ImportError("Importación cancelada o modificada.");
}
async function checkCancelled(id: string) {
  const job = await prisma.importJob.findUniqueOrThrow({ where: { id }, select: { status: true } });
  if (job.status === "CANCELLED") throw new ImportError("Importación cancelada.");
}

export async function processImport(id: string) {
  const lock = new Client({ connectionString: process.env.DATABASE_URL });
  await lock.connect();
  try {
    const result = await lock.query('SELECT pg_try_advisory_lock(hashtextextended($1,0)) AS locked', [id]);
    if (result.rows[0].locked) await runImport(id);
  } finally { await lock.end(); }
}
async function runImport(id: string) {
  const job = await prisma.importJob.findUnique({ where: { id } });
  if (!job || job.status === "COMPLETED" || job.status === "CANCELLED" || job.status === "REVIEW") return;
  const claim = await prisma.importJob.updateMany({ where: { id, status: { in: ["QUEUED", "PROCESSING", "FAILED"] } }, data: { status: "PROCESSING", phase: "Preparando", processed: 0, error: null } });
  if (!claim.count) return;
  try {
    await actorFor(job);
    if (job.kind === "CSV") await processCsv(job);
    else await processImages(job);
  } catch (cause) {
    const current = await prisma.importJob.findUniqueOrThrow({ where: { id }, select: { status: true } });
    if (current.status === "COMPLETED" || current.status === "CANCELLED") return;
    const message = cause instanceof ImportError || cause instanceof ImageError ? cause.message : job.kind === "CSV"
      ? "No se pudo procesar el CSV. Revisa codificación UTF-8, encabezados, delimitador, comillas y longitudes. Puedes reintentar sin volver a subirlo."
      : "No se pudo procesar el archivo de imágenes. Revisa formato ZIP, nombres alfanuméricos y archivos admitidos.";
    await prisma.importJob.update({ where: { id }, data: { status: "FAILED", phase: "No publicada", error: message } });
    console.error("IMPORT_PROCESSING_FAILED");
  }
}

async function processCsv(job: ImportJob) {
  const temporary = join(importRoot(), "tmp", job.id);
  await mkdir(temporary, { recursive: true, mode: 0o700 });
  const db = await DuckDBInstance.create(":memory:", { threads: "2", memory_limit: "256MB", temp_directory: temporary, max_temp_directory_size: "4GB", autoinstall_known_extensions: "false", autoload_known_extensions: "false" });
  const connection = await db.connect();
  const interrupt = setTimeout(() => connection.interrupt(), 30 * 60_000);
  const cancellation = setInterval(() => { void checkCancelled(job.id).catch(() => connection.interrupt()); }, 2000);
  const source = `read_csv(${literal(sourcePath(job.sourceKey))}, header=true, all_varchar=true, maximum_line_size=65536, strict_mode=true)`;
  try {
    const preview = await connection.runAndReadAll(`SELECT * FROM ${source} LIMIT 0`);
    const headers = preview.columnNames();
    if (!headers.length || headers.length > 100) throw new ImportError("El CSV debe tener entre 1 y 100 columnas.");
    if (!job.mapping) {
      await updateProgress(job.id, { headers, status: "REVIEW", phase: "Selecciona el mapeo de columnas" });
      return;
    }
    const mapping = mappingSchema.parse(job.mapping);
    if (Object.values(mapping).some(column => column && !headers.includes(column))) throw new ImportError("El mapeo contiene columnas que no están en el archivo.");
    const column = (name?: string) => name ? `trim(coalesce(${identifier(name)}, ''))` : "''";
    const folio = column(mapping.folio), alpha = column(mapping.alfanum), tipo = column(mapping.tipo), otro = column(mapping.otro);
    await updateProgress(job.id, { phase: "Validando todos los registros" });
    await connection.run(`CREATE TEMP TABLE records AS SELECT row_number() OVER () AS record_number, ${folio} AS folio, ${alpha} AS alfanum, upper(${alpha}) AS normalized, nullif(${tipo}, '') AS tipo, nullif(${otro}, '') AS otro FROM ${source}`);
    const empty = "folio='' AND alfanum='' AND tipo IS NULL AND otro IS NULL";
    const valid = "length(folio) BETWEEN 1 AND 500 AND regexp_full_match(alfanum, '[A-Za-z0-9]{1,128}') AND coalesce(length(tipo),0)<=2000 AND coalesce(length(otro),0)<=2000";
    const count = (await connection.runAndReadAll(`SELECT count(*) AS total, count(*) FILTER (WHERE ${empty}) AS empty_rows, count(*) FILTER (WHERE NOT (${empty}) AND NOT (${valid})) AS invalid_rows FROM records`)).getRowObjectsJson()[0];
    const duplicate = (await connection.runAndReadAll(`SELECT count(*) AS groups FROM (SELECT normalized FROM records WHERE ${valid} GROUP BY normalized HAVING count(*)>1)`)).getRowObjectsJson()[0];
    const total = Number(count.total), invalidRows = Number(count.invalid_rows), emptyRows = Number(count.empty_rows), duplicateGroups = Number(duplicate.groups);
    if (total > 5_000_000) throw new ImportError("El CSV supera el límite de 5 millones de registros por importación.");
    const examples = (await connection.runAndReadAll(`SELECT record_number, alfanum FROM records WHERE NOT (${empty}) AND NOT (${valid}) LIMIT 20`)).getRowObjectsJson();
    const duplicates = (await connection.runAndReadAll(`SELECT normalized AS alfanum, count(*) AS repetitions FROM records WHERE ${valid} GROUP BY normalized HAVING count(*)>1 LIMIT 20`)).getRowObjectsJson();
    const summary = { total, invalidRows, emptyRows, duplicateGroups, examples, duplicates } as Prisma.InputJsonObject;
    if (invalidRows || duplicateGroups || total === emptyRows) {
      await updateProgress(job.id, { total, processed: total, status: "REVIEW", phase: "Corrige los errores antes de publicar", summary });
      return;
    }
    await checkCancelled(job.id);
    const validation = await prisma.validation.findUniqueOrThrow({ where: { id: job.validationId } });
    if (job.candidateDatasetId) {
      const old = await prisma.dataset.findUnique({ where: { id: job.candidateDatasetId } });
      if (old && (old.status === "BUILDING" || old.status === "READY")) {
        await prisma.folio.deleteMany({ where: { datasetId: old.id } });
        await prisma.dataset.delete({ where: { id: old.id } });
      }
    }
    const datasetId = randomUUID();
    await prisma.dataset.create({ data: { id: datasetId, tenantId: job.tenantId, validationId: job.validationId } });
    await updateProgress(job.id, { phase: "Preparando nueva base", total, candidateDatasetId: datasetId, baseDatasetId: validation.activeDatasetId });
    const prepared = join(temporary, "prepared.csv");
    await connection.run(`COPY (SELECT ${literal(job.tenantId)}, ${literal(job.validationId)}, ${literal(datasetId)}, folio, alfanum, normalized, tipo, otro FROM records WHERE ${valid}) TO ${literal(prepared)} (FORMAT CSV, HEADER false)`);
    const pg = new Client({ connectionString: process.env.DATABASE_URL });
    await pg.connect();
    try {
      await pg.query("SET statement_timeout='15min'");
      await pipeline(createReadStream(prepared), pg.query(copyFrom('COPY "Folio" ("tenantId","validationId","datasetId","folio","alfanum","alfanumNormalized","tipo","otro") FROM STDIN WITH (FORMAT csv)')));
      if (job.mode === "UPSERT" && validation.activeDatasetId) {
        if (!mapping.tipo) await pg.query('UPDATE "Folio" n SET tipo=o.tipo FROM "Folio" o WHERE n."datasetId"=$1 AND o."datasetId"=$2 AND n."alfanumNormalized"=o."alfanumNormalized"', [datasetId, validation.activeDatasetId]);
        if (!mapping.otro) await pg.query('UPDATE "Folio" n SET otro=o.otro FROM "Folio" o WHERE n."datasetId"=$1 AND o."datasetId"=$2 AND n."alfanumNormalized"=o."alfanumNormalized"', [datasetId, validation.activeDatasetId]);
        await pg.query('INSERT INTO "Folio" ("tenantId","validationId","datasetId",folio,alfanum,"alfanumNormalized",tipo,otro) SELECT "tenantId","validationId",$1,folio,alfanum,"alfanumNormalized",tipo,otro FROM "Folio" o WHERE "datasetId"=$2 AND NOT EXISTS (SELECT 1 FROM "Folio" n WHERE n."datasetId"=$1 AND n."alfanumNormalized"=o."alfanumNormalized")', [datasetId, validation.activeDatasetId]);
      }
    } finally { await pg.end(); }
    await checkCancelled(job.id);
    const recordCount = await prisma.folio.count({ where: { datasetId } });
    const missing = await prisma.$queryRaw<Array<{ count: bigint }>>`SELECT count(*) FROM "Folio" f LEFT JOIN "RecordImage" i ON i."tenantId"=f."tenantId" AND i."validationId"=f."validationId" AND i."alfanumNormalized"=f."alfanumNormalized" WHERE f."datasetId"=${datasetId}::uuid AND i.id IS NULL`;
    await prisma.dataset.update({ where: { id: datasetId }, data: { status: "READY", recordCount } });
    await updateProgress(job.id, { status: "REVIEW", phase: "Revisa y publica la nueva base", processed: total, summary: { ...summary, records: recordCount, missingImages: Number(missing[0].count) } });
  } finally {
    clearTimeout(interrupt); clearInterval(cancellation);
    connection.closeSync(); db.closeSync();
    await rm(temporary, { recursive: true, force: true });
  }
}

async function processImages(job: ImportJob) {
  const isDirectory = job.sourceKey === `${job.id}.directory`;
  if (isDirectory) await captureDirectoryImport(job);
  const directoryTotal = isDirectory ? (await prisma.importJob.findUniqueOrThrow({ where: { id: job.id }, select: { total: true } })).total : 1;
  if (isDirectory && directoryTotal === 0) {
    await prisma.importJob.update({ where: { id: job.id }, data: { status: "COMPLETED", processed: 0, phase: "Carpeta vacía", summary: { new: 0, replacements: 0, unchanged: 0, errors: 0 } } });
    return;
  }
  const target = job.imageStorageKind ? { kind: job.imageStorageKind, tenantId: job.tenantId, validationId: job.validationId } : undefined;
  // The persisted source is immutable; retries reuse already validated staging files.
  const cached = new Set((await prisma.importImageItem.findMany({ where: { jobId: job.id }, select: { alfanumNormalized: true } })).map(item => item.alfanumNormalized));
  const seen = new Set<string>();
  const issues: string[] = [];
  let errorCount = 0, processed = 0, expanded = 0;
  let batch: Prisma.ImportImageItemCreateManyInput[] = [];
  async function flush() {
    if (batch.length) { await prisma.importImageItem.createMany({ data: batch }); batch = []; }
    await checkCancelled(job.id);
    const space = await statfs(importRoot());
    if (space.bavail * space.bsize < 2 * 1024 ** 3) throw new ImportError("No hay espacio suficiente para continuar. Libera espacio y reintenta sin subir de nuevo.");
    await updateProgress(job.id, { processed, phase: "Validando imágenes" });
  }
  async function image(filename: string, input: Buffer, sourceHash?: string) {
    processed++;
    if (processed > 50_000) throw new ImportError("El lote supera las 50,000 imágenes permitidas.");
    try {
      const name = basename(filename);
      const normalized = imageAlfanum(name);
      if (seen.has(normalized)) throw new ImageError(400, `El alfanumérico ${normalized} aparece más de una vez en el lote.`);
      seen.add(normalized);
      if (cached.has(normalized)) { if (processed % 100 === 0) await flush(); return; }
      if (sourceHash) {
        const current = await prisma.recordImage.findUnique({ where: { tenantId_validationId_alfanumNormalized: { tenantId: job.tenantId, validationId: job.validationId, alfanumNormalized: normalized } }, select: { id: true, sourceHash: true } });
        if (current?.sourceHash === sourceHash) { if (processed % 100 === 0) await flush(); return; }
        const prepared = await prepareImage(input, basename(filename), mimeFor(filename));
        const key = await writeImageFile(prepared.data, target);
        batch.push({ jobId: job.id, alfanumNormalized: normalized, originalName: basename(filename), storageKey: key, width: prepared.width, height: prepared.height, size: prepared.data.length, sourceHash, replacesImageId: current?.id });
        if (processed % 100 === 0) await flush();
        return;
      }
      const extension = extname(name).toLowerCase();
      const mime = extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".png" ? "image/png" : "image/webp";
      const prepared = await prepareImage(input, name, mime);
      const key = await writeImageFile(prepared.data, target);
      batch.push({ jobId: job.id, alfanumNormalized: normalized, originalName: name, storageKey: key, width: prepared.width, height: prepared.height, size: prepared.data.length });
    } catch (cause) {
      if (cause && typeof cause === "object" && "code" in cause && ["ENOSPC", "EACCES", "EROFS", "EDQUOT"].includes(String(cause.code))) throw new ImportError("No se pudieron guardar imágenes. Revisa el espacio y los permisos; después reintenta sin subir el ZIP de nuevo.");
      errorCount++;
      const reason = cause instanceof ImageError ? cause.message : cause instanceof ZodError
        ? "El nombre sin extensión debe tener entre 1 y 128 letras ASCII o números, sin espacios ni símbolos."
        : "No se pudo guardar la imagen procesada. No hay un diagnóstico de formato disponible; solicita revisar los registros del servidor.";
      if (issues.length < 100) issues.push(`${basename(filename).slice(0, 200)}: ${reason}`);
    }
    if (processed % 100 === 0) await flush();
  }
  if (isDirectory) {
    for await (const source of readDirectorySnapshot(job.id)) await image(source.filename, await readDirectorySnapshotFile(job.id, source), source.sourceHash);
  } else if (job.sourceKey.endsWith(".zip")) {
    const inspected = await inspectImageArchive(sourcePath(job.sourceKey));
    const zip = await openPromise(sourcePath(job.sourceKey), { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
    try {
      if (zip.entryCount > 100_000) throw new ImportError("El ZIP contiene demasiadas entradas.");
      await updateProgress(job.id, { total: inspected.files });
      for await (const entry of zip.eachEntry()) {
        const parts = entry.fileName.split("/");
        if (isAbsolute(entry.fileName) || parts.includes("..") || entry.isEncrypted() || ((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new ImportError("El ZIP contiene rutas no permitidas, enlaces o archivos cifrados.");
        if (entry.fileName.endsWith("/") || parts.includes("__MACOSX") || basename(entry.fileName).startsWith(".")) continue;
        expanded += entry.uncompressedSize;
        if (expanded > MAX_EXPANDED_BYTES) throw new ImportError("El ZIP supera el espacio descomprimido permitido.");
        if (entry.uncompressedSize > MAX_IMAGE_BYTES || (entry.uncompressedSize > 1024 ** 2 && entry.uncompressedSize / Math.max(entry.compressedSize, 1) > 200)) throw new ImportError("Una imagen supera10MiB o la compresión del ZIP no es segura.");
        const stream = await zip.openReadStreamPromise(entry);
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of stream) {
          bytes += chunk.length;
          if (bytes > MAX_IMAGE_BYTES) { stream.destroy(); throw new ImportError("Una imagen supera10MiB."); }
          chunks.push(Buffer.from(chunk));
        }
        await image(entry.fileName, Buffer.concat(chunks, bytes));
      }
    } finally { zip.close(); }
  } else {
    await updateProgress(job.id, { total: 1 });
    await image(job.originalName, await readFile(sourcePath(job.sourceKey)));
  }
  await flush();
  if (errorCount || !processed) {
    await updateProgress(job.id, { status: "FAILED", total: processed, error: "El lote no se publicó. Corrige los archivos indicados.", summary: { errorCount, issues } });
    return;
  }
  if (isDirectory) {
    const replacements = await prisma.importImageItem.count({ where: { jobId: job.id, replacesImageId: { not: null } } });
    if (replacements) {
      const newCount = await prisma.importImageItem.count({ where: { jobId: job.id, replacesImageId: null } });
      await updateProgress(job.id, { status: "REVIEW", phase: "Revisa los reemplazos antes de publicar", processed, total: processed, summary: { new: newCount, replacements, unchanged: processed - newCount - replacements, errors: errorCount } });
      return;
    }
  }
  const actor = await actorFor(job);
  const previous = await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const validation = await lockValidation(tx, user, job.validationId);
    if (validation.imageStorageKind !== job.imageStorageKind) throw new ImportError("El destino de imágenes cambió. Inicia una nueva carga.");
    const current = await tx.importJob.findUniqueOrThrow({ where: { id: job.id } });
    if (current.status === "CANCELLED") throw new ImportError("Importación cancelada.");
    if (current.status === "COMPLETED") return [];
    if (isDirectory && validation.imageRevision !== job.baseImageRevision) throw new ImportError("El catálogo cambió desde el análisis. Vuelve a procesar la carpeta antes de publicar.");
    const conflicts = await tx.$queryRaw<Array<{ storageKey: string }>>`SELECT r."storageKey" FROM "RecordImage" r JOIN "ImportImageItem" i ON i."alfanumNormalized"=r."alfanumNormalized" WHERE i."jobId"=${job.id}::uuid AND r."tenantId"=${job.tenantId}::uuid AND r."validationId"=${job.validationId}::uuid`;
    const [existingCount, stagedCount] = await Promise.all([tx.recordImage.count({ where: { validationId: job.validationId } }), tx.importImageItem.count({ where: { jobId: job.id } })]);
    if (existingCount + stagedCount - conflicts.length > 50000) throw new ImportError("La validación supera el máximo de 50,000 imágenes. Elimina o reemplaza imágenes antes de ampliar el catálogo.");
    if (conflicts.length && !job.replaceImages) throw new ImportError("Ya existen imágenes de esos alfanuméricos. Usa reintentar reemplazando existentes para aprovechar el archivo ya recibido.");
    await tx.$executeRaw`INSERT INTO "RecordImage" (id,"tenantId","validationId","alfanumNormalized","originalName","storageKey",width,height,size,"sourceHash","createdAt","updatedAt") SELECT id,${job.tenantId}::uuid,${job.validationId}::uuid,"alfanumNormalized","originalName","storageKey",width,height,size,"sourceHash",now(),now() FROM "ImportImageItem" WHERE "jobId"=${job.id}::uuid ON CONFLICT ("tenantId","validationId","alfanumNormalized") DO UPDATE SET "originalName"=EXCLUDED."originalName","storageKey"=EXCLUDED."storageKey",width=EXCLUDED.width,height=EXCLUDED.height,size=EXCLUDED.size,"sourceHash"=EXCLUDED."sourceHash","updatedAt"=now()`;
    await tx.validation.update({ where: { id: job.validationId }, data: { imageRevision: { increment: 1 } } });
    await tx.importJob.update({ where: { id: job.id }, data: { status: "COMPLETED", phase: "Imágenes publicadas", total: processed, processed, summary: { images: processed, replaced: conflicts.length } } });
    await tx.auditLog.create({ data: { actorId: user.id, tenantId: validation.tenantId, targetId: validation.id, action: "BULK_IMAGES_PUBLISHED", metadata: { jobId: job.id, images: processed } } });
    return conflicts.map(row => row.storageKey);
  }, { timeout: 120000 });
  for (const key of previous) await removeImageFile(key).catch(() => console.error("IMAGE_CLEANUP_FAILED"));
  if (isDirectory) {
    const cleanupPending = await cleanupPublishedDirectoryOriginals(job);
    if (cleanupPending) await prisma.importJob.update({ where: { id: job.id }, data: { phase: `${cleanupPending} originales siguen pendientes de limpieza` } });
  }
}

function mimeFor(filename: string) { const extension = extname(filename).toLowerCase(); return extension === ".jpg" || extension === ".jpeg" ? "image/jpeg" : extension === ".png" ? "image/png" : "image/webp"; }
