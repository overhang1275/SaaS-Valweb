import { constants, type BigIntStats } from "node:fs";
import { open, opendir, readFile, rename, statfs, unlink, type FileHandle } from "node:fs/promises";
import { createHash, randomUUID } from "node:crypto";
import { extname, join } from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { ImportJob } from "@/generated/prisma/client";
import { imageAlfanum } from "@/features/records/alfanum";
import { ImageError, MAX_IMAGE_BYTES } from "@/features/images/limits";
import { prepareImage } from "@/features/images/processing";
import { childDirectory, handlePath, openDirectory, openImageStorageRoot } from "@/features/images/filesystem";
import { importRoot } from "./files";
import { MAX_EXPANDED_BYTES } from "./archive";

const MAX_IMAGES = 50_000;
const RESERVED_BYTES = 2 * 1024 ** 3;
const imageExtension = new Set([".jpg", ".jpeg", ".png", ".webp"]);
const imageMime: Record<string, string> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };
const sourceSchema = z.object({ filename: z.string().min(1).max(200), snapshotKey: z.string().regex(/^[a-f0-9-]{36}\.bin$/), sourceHash: z.string().regex(/^[a-f0-9]{64}$/), bytes: z.number().int().positive().max(10 * 1024 ** 2), dev: z.string(), ino: z.string(), mtimeNs: z.string(), ctimeNs: z.string() });
const markerSchema = z.object({ sha256: z.string().regex(/^[a-f0-9]{64}$/), files: z.number().int().min(0).max(MAX_IMAGES) });

export type DirectorySource = z.infer<typeof sourceSchema>;
const snapshots = new Map<string, Map<string, DirectorySource>>();

function sameFile(first: BigIntStats, second: BigIntStats) {
  return first.isFile() && second.isFile() && first.dev === second.dev && first.ino === second.ino && first.size === second.size && first.mtimeNs === second.mtimeNs && first.ctimeNs === second.ctimeNs;
}
function isTemporary(name: string) { return name.startsWith(".") || /\.(?:part|tmp|uploading)$/i.test(name); }
function incompleteError() { return new ImageError(409, "La captura quedó incompleta. Inicia un análisis nuevo para volver a leer la carpeta."); }
async function readBounded(handle: FileHandle, maximum: number) {
  const chunks: Buffer[] = []; let size = 0;
  while (size <= maximum) {
    const buffer = Buffer.allocUnsafe(Math.min(64 * 1024, maximum + 1 - size));
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, size);
    if (!bytesRead) break;
    chunks.push(buffer.subarray(0, bytesRead)); size += bytesRead;
  }
  if (size > maximum) throw new ImageError(413, "El archivo supera el límite de 10 MiB.");
  return Buffer.concat(chunks, size);
}

async function openJobDirectory(jobId: string, create: boolean) {
  const root = await openDirectory(importRoot(), create);
  let directory: FileHandle;
  try { directory = await childDirectory(root, "directory", create); }
  finally { await root.close(); }
  try { return await childDirectory(directory, jobId.toLowerCase(), create); }
  finally { await directory.close(); }
}

async function writePrivateFile(parent: FileHandle, name: string, contents: string) {
  const file = await open(join(handlePath(parent), name), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try { await file.writeFile(contents); await file.sync(); }
  finally { await file.close(); }
}

async function readCompleteManifest(directory: FileHandle): Promise<DirectorySource[]> {
  try {
    const marker = markerSchema.parse(JSON.parse(await readFile(join(handlePath(directory), ".complete"), "utf8")));
    const manifestFile = await open(join(handlePath(directory), "manifest.ndjson"), constants.O_RDONLY | constants.O_NOFOLLOW);
    let manifest: Buffer;
    try { if (!(await manifestFile.stat()).isFile()) throw incompleteError(); manifest = await manifestFile.readFile(); }
    finally { await manifestFile.close(); }
    if (createHash("sha256").update(manifest).digest("hex") !== marker.sha256) throw incompleteError();
    const records = manifest.toString("utf8").split("\n").filter(Boolean).map(line => sourceSchema.parse(JSON.parse(line)));
    if (records.length !== marker.files) throw incompleteError();
    return records;
  } catch (cause) {
    if (cause instanceof ImageError) throw cause;
    throw incompleteError();
  }
}

export async function captureDirectoryImport(job: ImportJob): Promise<void> {
  if (job.kind !== "IMAGES" || job.imageStorageKind === null || job.sourceKey !== `${job.id}.directory`) throw new ImageError(400, "El trabajo no corresponde a una captura de carpeta.");
  const existing = await prisma.importJob.findUnique({ where: { id: job.id }, select: { status: true } });
  if (!existing || existing.status === "CANCELLED") throw new ImageError(409, "El análisis fue cancelado.");

  let directory: FileHandle, created = false;
  try { directory = await openJobDirectory(job.id, false); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") { directory = await openJobDirectory(job.id, true); created = true; } else throw cause; }
  try {
    let complete = false;
    try {
      const marker = await open(join(handlePath(directory), ".complete"), constants.O_RDONLY | constants.O_NOFOLLOW);
      await marker.close();
      complete = true;
    } catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw incompleteError(); }
    if (complete) {
      const records = await readCompleteManifest(directory);
      snapshots.set(job.id, new Map(records.map(record => [record.snapshotKey, record])));
      await prisma.importJob.update({ where: { id: job.id }, data: { total: records.length, processed: 0, phase: records.length ? "Captura lista para procesar" : "Carpeta vacía" } });
      return;
    }
    if (!created) throw incompleteError();
    await writePrivateFile(directory, ".started", new Date().toISOString());

    const validation = await prisma.validation.findFirst({ where: { id: job.validationId, tenantId: job.tenantId }, select: { tenantId: true, imageMode: true, imageStorageKind: true } });
    if (!validation || validation.imageMode !== "PER_RECORD" || validation.imageStorageKind !== job.imageStorageKind) throw new ImageError(409, "El destino de la validación cambió. Inicia un análisis nuevo.");
    const location = await prisma.imageStorageLocation.findUnique({ where: { kind: job.imageStorageKind } });
    if (!location) throw new ImageError(503, "El destino de imágenes no está configurado.");
    const root = await openImageStorageRoot(location.rootPath, location.kind);
    let validationFolder: FileHandle | undefined;
    let inbox: FileHandle | undefined;
    let files: FileHandle | undefined;
    try {
      validationFolder = await childDirectory(root, `${validation.tenantId}_${job.validationId}`, false);
      inbox = await childDirectory(validationFolder, "por_procesar", false);
      files = await childDirectory(directory, "files", true);
      const folderEntries = await opendir(handlePath(inbox));
      const seen = new Set<string>(), records: DirectorySource[] = [];
      let totalBytes = 0;
      const controller = new AbortController();
      const cancellation = setInterval(() => {
        void prisma.importJob.findUnique({ where: { id: job.id }, select: { status: true } }).then(current => {
          if (!current || current.status === "CANCELLED") controller.abort(new ImageError(409, "El análisis fue cancelado."));
        }).catch(() => controller.abort(new ImageError(503, "No se pudo comprobar el estado del análisis.")));
      }, 2000);
      try {
        for await (const entry of folderEntries) {
          if (isTemporary(entry.name)) continue;
          const extension = extname(entry.name).toLowerCase();
          if (entry.isSymbolicLink() && imageExtension.has(extension)) throw new ImageError(400, "La carpeta contiene un enlace simbólico y no se procesó.");
          if (!entry.isFile()) continue;
          if (!imageExtension.has(extension)) throw new ImageError(400, "La carpeta contiene un archivo con formato no admitido.");
          let alfanum: string;
          try { alfanum = imageAlfanum(entry.name); }
          catch { throw new ImageError(400, "Revisa los nombres de archivo: deben corresponder a un código alfanumérico."); }
          if (seen.has(alfanum)) throw new ImageError(400, `Hay más de una imagen para el código ${alfanum}.`);
          seen.add(alfanum);
          if (records.length >= MAX_IMAGES) throw new ImageError(413, "La carpeta supera el límite de 50,000 imágenes.");

          const source = await open(join(handlePath(inbox), entry.name), constants.O_RDONLY | constants.O_NOFOLLOW);
          try {
            const snapshotKey = `${randomUUID()}.bin`;
            const target = await open(join(handlePath(files), snapshotKey), constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
            try {
            const before = await source.stat({ bigint: true });
            if (!before.isFile() || before.size < 1n) throw new ImageError(400, "La carpeta contiene una imagen vacía o un archivo no regular.");
            if (before.size > BigInt(MAX_IMAGE_BYTES)) throw new ImageError(413, "Una imagen supera el límite de 10 MiB.");
            if (totalBytes + Number(before.size) > MAX_EXPANDED_BYTES) throw new ImageError(413, "La captura supera el límite total de datos.");
            const space = await statfs(importRoot());
            if (space.bavail * space.bsize < totalBytes + Number(before.size) + RESERVED_BYTES) throw new ImageError(507, "No hay suficiente espacio libre para capturar las imágenes.");
            const contents = await readBounded(source, MAX_IMAGE_BYTES);
            const hash = createHash("sha256").update(contents);
            const bytes = contents.length;
            await target.writeFile(contents);
            await target.sync();
            await prepareImage(contents, entry.name, imageMime[extension]);
            const after = await source.stat({ bigint: true });
            const current = await open(join(handlePath(inbox), entry.name), constants.O_RDONLY | constants.O_NOFOLLOW);
            try { if (!sameFile(before, after) || !sameFile(before, await current.stat({ bigint: true })) || bytes !== Number(before.size)) throw new ImageError(409, "Un archivo cambió mientras se copiaba. Vuelve a subirlo y renómbralo al terminar."); }
            finally { await current.close(); }
            if (controller.signal.aborted) throw new ImageError(409, "El análisis fue cancelado.");
            totalBytes += bytes;
            records.push({ filename: entry.name, snapshotKey, sourceHash: hash.digest("hex"), bytes, dev: before.dev.toString(), ino: before.ino.toString(), mtimeNs: before.mtimeNs.toString(), ctimeNs: before.ctimeNs.toString() });
            } finally { await target.close(); }
          } finally { await source.close(); }
        }
        if (controller.signal.aborted) throw new ImageError(409, "El análisis fue cancelado.");
        const current = await prisma.importJob.findUnique({ where: { id: job.id }, select: { status: true } });
        if (!current || current.status === "CANCELLED") throw new ImageError(409, "El análisis fue cancelado.");
      } finally { clearInterval(cancellation); }

      records.sort((a, b) => a.filename.localeCompare(b.filename, "en"));
      const manifest = records.map(record => JSON.stringify(sourceSchema.parse(record))).join("\n") + (records.length ? "\n" : "");
      await writePrivateFile(directory, "manifest.ndjson", manifest);
      const marker = JSON.stringify({ sha256: createHash("sha256").update(manifest).digest("hex"), files: records.length });
      await writePrivateFile(directory, ".complete.tmp", marker);
      await rename(join(handlePath(directory), ".complete.tmp"), join(handlePath(directory), ".complete"));
      await directory.sync();
      snapshots.set(job.id, new Map(records.map(record => [record.snapshotKey, record])));
      await prisma.importJob.update({ where: { id: job.id }, data: { total: records.length, processed: 0, phase: records.length ? "Captura lista para procesar" : "Carpeta vacía" } });
    } finally {
      await files?.close(); await inbox?.close(); await validationFolder?.close(); await root.close();
    }
  } finally { await directory.close(); }
}

export async function* readDirectorySnapshot(jobId: string): AsyncGenerator<DirectorySource> {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(jobId)) throw new ImageError(400, "Trabajo no válido.");
  const records = await snapshotRecords(jobId);
  for (const record of records.values()) yield record;
}

export async function readDirectorySnapshotFile(jobId: string, input: DirectorySource) {
  const record = sourceSchema.parse(input);
  if (!/^[a-f0-9-]{36}\.bin$/i.test(record.snapshotKey)) throw new ImageError(400, "Archivo de captura no válido.");
  const known = (await snapshotRecords(jobId)).get(record.snapshotKey);
  if (!known || JSON.stringify(known) !== JSON.stringify(record)) throw incompleteError();
  const directory = await openJobDirectory(jobId, false);
  try {
    const files = await childDirectory(directory, "files", false);
    try {
      const file = await open(join(handlePath(files), record.snapshotKey), constants.O_RDONLY | constants.O_NOFOLLOW);
      let bytes: Buffer;
      try { const stat = await file.stat(); if (!stat.isFile() || stat.size !== record.bytes) throw new ImageError(409, "La captura no coincide con su manifiesto."); bytes = await readBounded(file, record.bytes); }
      finally { await file.close(); }
      if (bytes.length !== record.bytes || createHash("sha256").update(bytes).digest("hex") !== record.sourceHash) throw new ImageError(409, "La captura no coincide con su manifiesto.");
      return bytes;
    }
    finally { await files.close(); }
  } finally { await directory.close(); }
}

async function snapshotRecords(jobId: string) {
  if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(jobId)) throw new ImageError(400, "Trabajo no válido.");
  const cached = snapshots.get(jobId);
  if (cached) return cached;
  const directory = await openJobDirectory(jobId, false);
  try {
    const records = await readCompleteManifest(directory);
    const result = new Map(records.map(record => [record.snapshotKey, record]));
    snapshots.set(jobId, result);
    return result;
  } finally { await directory.close(); }
}

export async function removeDirectoryOriginal(job: ImportJob, source: DirectorySource) {
  const validation = await prisma.validation.findFirst({ where: { id: job.validationId, tenantId: job.tenantId }, select: { tenantId: true, imageStorageKind: true } });
  if (!validation || validation.imageStorageKind !== job.imageStorageKind || !job.imageStorageKind) return false;
  const location = await prisma.imageStorageLocation.findUnique({ where: { kind: job.imageStorageKind } });
  if (!location) return false;
  const root = await openImageStorageRoot(location.rootPath, location.kind);
  let folder: FileHandle | undefined, inbox: FileHandle | undefined;
  try {
    folder = await childDirectory(root, `${validation.tenantId}_${job.validationId}`, false);
    inbox = await childDirectory(folder, "por_procesar", false);
    const path = join(handlePath(inbox), source.filename);
    const original = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = await original.stat({ bigint: true });
      if (!stat.isFile() || stat.dev.toString() !== source.dev || stat.ino.toString() !== source.ino || stat.size !== BigInt(source.bytes) || stat.mtimeNs.toString() !== source.mtimeNs || stat.ctimeNs.toString() !== source.ctimeNs) return false;
      if (createHash("sha256").update(await readBounded(original, MAX_IMAGE_BYTES)).digest("hex") !== source.sourceHash) return false;
    } finally { await original.close(); }
    await unlink(path);
    return true;
  } catch (cause) { if ((cause as NodeJS.ErrnoException).code === "ENOENT") return false; throw cause; }
  finally { await inbox?.close(); await folder?.close(); await root.close(); }
}

export async function cleanupPublishedDirectoryOriginals(job: ImportJob) {
  let pending = 0;
  for await (const source of readDirectorySnapshot(job.id)) {
    const normalized = imageAlfanum(source.filename);
    const published = await prisma.recordImage.findUnique({ where: { tenantId_validationId_alfanumNormalized: { tenantId: job.tenantId, validationId: job.validationId, alfanumNormalized: normalized } }, select: { sourceHash: true } });
    if (published?.sourceHash === source.sourceHash) {
      try { await removeDirectoryOriginal(job, source); }
      catch { pending++; }
    }
  }
  return pending;
}
