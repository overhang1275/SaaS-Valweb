import { access, opendir, type FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentActor, type Actor } from "@/features/identity/service";
import { lockValidation } from "@/features/validations/service";
import type { ImageStorageLocation, Prisma, StorageKind } from "@/generated/prisma/client";
import { ImageError } from "./limits";
import { childDirectory, handlePath, imageRootPath, openImageStorageRoot, pathsOverlap } from "./filesystem";
import { lockImageLocation } from "./storage";

const locationSchema = z.object({ kind: z.enum(["LOCAL", "NFS"]), rootPath: z.string() });
const folderPattern = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}_[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;
const inboxImage = /\.(?:jpe?g|png|webp)$/i;

async function pendingImageCount(folder: FileHandle) {
  const inbox = await childDirectory(folder, "por_procesar", false);
  try {
    const entries = await opendir(handlePath(inbox));
    let count = 0;
    for await (const entry of entries) {
      if (entry.isFile() && !entry.name.startsWith(".") && inboxImage.test(entry.name) && !/\.(?:part|tmp|uploading)$/i.test(entry.name)) {
        count++;
        if (count > 50_000) break;
      }
    }
    return count;
  } finally { await inbox.close(); }
}

async function lockConfiguration(tx: Prisma.TransactionClient) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('valweb-image-storage', 0))`;
  await tx.$queryRaw`SELECT kind FROM "ImageStorageLocation" ORDER BY kind FOR UPDATE`;
}

export async function ensureDefaultLocalImageLocation(tx: Prisma.TransactionClient, rootPath: string) {
  const path = imageRootPath(rootPath);
  await lockConfiguration(tx);
  const existing = await tx.imageStorageLocation.findUnique({ where: { kind: "LOCAL" } });
  if (existing) return existing;
  const nfs = await tx.imageStorageLocation.findUnique({ where: { kind: "NFS" } });
  if (nfs && pathsOverlap(path, resolve(nfs.rootPath))) throw new ImageError(409, "La ruta local predeterminada coincide con el destino NFS configurado.");
  return tx.imageStorageLocation.create({ data: { kind: "LOCAL", rootPath: path } });
}

export async function saveGlobalImageLocation(actor: Actor, input: unknown): Promise<void> {
  await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor, true);
    const data = locationSchema.parse(input), rootPath = imageRootPath(data.rootPath);
    await lockConfiguration(tx);
    const locations = await tx.imageStorageLocation.findMany();
    const current = locations.find(row => row.kind === data.kind);
    if (locations.some(row => row.kind !== data.kind && pathsOverlap(rootPath, resolve(row.rootPath)))) throw new ImageError(409, "Las raíces local y NFS no pueden coincidir ni contenerse.");
    if (current && resolve(current.rootPath) !== rootPath) {
      const prefix = `v1:${data.kind}:`;
      const [shared, records, staged, jobs] = await Promise.all([
        tx.validation.count({ where: { imageKey: { startsWith: prefix } } }),
        tx.recordImage.count({ where: { storageKey: { startsWith: prefix } } }),
        tx.importImageItem.count({ where: { storageKey: { startsWith: prefix } } }),
        tx.importJob.count({ where: { imageStorageKind: data.kind } }),
      ]);
      if (shared || records || staged || jobs) throw new ImageError(409, "La ruta ya está utilizada por imágenes o cargas y no puede cambiarse sin un traslado verificado.");
      const handle = await openImageStorageRoot(current.rootPath, current.kind);
      try {
        const entries = await opendir(handlePath(handle));
        for await (const entry of entries) {
          if (folderPattern.test(entry.name)) throw new ImageError(409, "La ruta contiene carpetas de validación y no puede cambiarse sin un traslado verificado.");
        }
      } finally { await handle.close(); }
    }
    const handle = await openImageStorageRoot(rootPath, data.kind, true);
    await handle.close();
    if (current?.rootPath === rootPath) return;
    await tx.imageStorageLocation.upsert({ where: { kind: data.kind }, create: { kind: data.kind, rootPath }, update: { rootPath } });
    await tx.auditLog.create({ data: { actorId: user.id, action: "IMAGE_STORAGE_CONFIGURED", metadata: { kind: data.kind } } });
  });
}

export async function selectValidationImageStorage(actor: Actor, id: string, kind: StorageKind): Promise<void> {
  z.uuid().parse(id); z.enum(["LOCAL", "NFS"]).parse(kind);
  await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    // Match uploads: validation first, then roots, to avoid deadlocks between different actors.
    const validation = await lockValidation(tx, user, id);
    await lockConfiguration(tx);
    if (validation.imageStorageKind === kind) return;
    const [images, jobs] = await Promise.all([
      tx.recordImage.count({ where: { validationId: id } }),
      tx.importJob.count({ where: { validationId: id, kind: "IMAGES", status: { in: ["QUEUED", "PROCESSING", "REVIEW", "FAILED"] } } }),
    ]);
    if (validation.imageKey || images || jobs) throw new ImageError(409, "No puedes cambiar el destino mientras existan imágenes o cargas de imágenes pendientes o recuperables.");
    const location = await lockImageLocation(tx, kind);
    const handle = await openImageStorageRoot(location.rootPath, kind, true);
    await handle.close();
    await tx.validation.update({ where: { id }, data: { imageStorageKind: kind } });
    await tx.auditLog.create({ data: { actorId: user.id, tenantId: validation.tenantId, targetId: id, action: "VALIDATION_IMAGE_STORAGE_SELECTED", metadata: { kind } } });
  });
}

async function locationStatuses(locations: ImageStorageLocation[]) {
  return Promise.all((["LOCAL", "NFS"] as const).map(async kind => {
    const location = locations.find(row => row.kind === kind);
    let available = false;
    if (location) {
      try {
        const handle = await openImageStorageRoot(location.rootPath, kind);
        try { await access(handlePath(handle), constants.R_OK | constants.W_OK | constants.X_OK); available = true; }
        finally { await handle.close(); }
      } catch { /* Availability is reported without exposing filesystem diagnostics. */ }
    }
    return { kind, configured: Boolean(location), available, rootPath: location?.rootPath ?? "" };
  }));
}

export async function getGlobalImageLocations(actor: Actor) {
  const locations = await prisma.$transaction(async tx => {
    await currentActor(tx, actor, true);
    return tx.imageStorageLocation.findMany();
  });
  return locationStatuses(locations);
}

export async function getValidationImageStorage(actor: Actor, id: string) {
  const snapshot = await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const validation = await lockValidation(tx, user, id);
    const [locations, images, jobs] = await Promise.all([
      tx.imageStorageLocation.findMany(), tx.recordImage.count({ where: { validationId: id } }),
      tx.importJob.count({ where: { validationId: id, kind: "IMAGES", status: { in: ["QUEUED", "PROCESSING", "REVIEW", "FAILED"] } } }),
    ]);
    return { validation, locations, canViewPath: user.role === "ADMIN", lockedReason: validation.imageKey || images
      ? "El destino no puede cambiar mientras haya imágenes. Sus archivos y ubicación se conservan."
      : jobs ? "Termina o cancela las cargas de imágenes antes de cambiar el destino." : null };
  });
  const { validation, locations, canViewPath, lockedReason } = snapshot;
  const statuses = await locationStatuses(locations), folderName = `${validation.tenantId}_${validation.id}`;
  const selected = statuses.find(option => option.kind === validation.imageStorageKind);
  let folderState: "none" | "missing" | "ready" | "unavailable" = validation.imageStorageKind ? "unavailable" : "none";
  let pendingImages = 0;
  if (selected?.available) {
    try {
      const root = await openImageStorageRoot(selected.rootPath, selected.kind);
      try {
        const folder = await childDirectory(root, folderName, false);
        try {
          const processed = await childDirectory(folder, "procesadas", false); await processed.close();
          pendingImages = await pendingImageCount(folder);
        }
        finally { await folder.close(); }
      } finally { await root.close(); }
      folderState = "ready";
    } catch (cause) { folderState = (cause as NodeJS.ErrnoException).code === "ENOENT" ? "missing" : "unavailable"; }
  }
  return { kind: validation.imageStorageKind, folderName, folderState, lockedReason, pendingImages,
    options: statuses.map(({ kind, configured, available }) => ({ kind, configured, available })),
    ...(canViewPath && selected ? { fullPath: join(selected.rootPath, folderName) } : {}),
  };
}
export type ValidationImageStorage = Awaited<ReturnType<typeof getValidationImageStorage>>;

export async function createValidationImageFolder(actor: Actor, id: string): Promise<void> {
  await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const validation = await lockValidation(tx, user, id);
    if (!validation.imageStorageKind) throw new ImageError(400, "Selecciona un destino antes de crear la carpeta.");
    const location = await lockImageLocation(tx, validation.imageStorageKind);
    try {
      const root = await openImageStorageRoot(location.rootPath, location.kind, true);
      try {
        const folder = await childDirectory(root, `${validation.tenantId}_${validation.id}`, true);
        try {
          const inbox = await childDirectory(folder, "por_procesar", true); await inbox.close();
          const processed = await childDirectory(folder, "procesadas", true); await processed.close();
        }
        finally { await folder.close(); }
      } finally { await root.close(); }
    } catch (cause) {
      if (cause instanceof ImageError) throw cause;
      throw new ImageError(503, "No se pudo preparar la carpeta. Solicita revisar sus permisos y que no sea un enlace o archivo.");
    }
    await tx.auditLog.create({ data: { actorId: user.id, tenantId: validation.tenantId, targetId: id, action: "VALIDATION_IMAGE_FOLDER_PREPARED", metadata: { kind: location.kind } } });
  });
}
