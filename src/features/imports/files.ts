import { mkdir, statfs, unlink } from "node:fs/promises";
import { createWriteStream } from "node:fs";
import { resolve, join, sep } from "node:path";
import { randomUUID } from "node:crypto";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { ImageError } from "@/features/images/limits";

export const MAX_ZIP_BYTES = Number(process.env.MAX_ZIP_BYTES || 50 * 1024 ** 3);
export const MAX_CSV_BYTES = 100 * 1024 ** 2;
export function importRoot() {
  const directory = resolve(process.env.IMPORT_STORAGE_DIR || "var/imports");
  const publicDirectory = resolve("public");
  if (directory === publicDirectory || directory.startsWith(publicDirectory + sep)) throw new Error("El directorio de importación debe ser privado.");
  return directory;
}
export function sourcePath(key: string) {
  if (!/^[a-f0-9-]{36}\.(csv|zip|jpg|jpeg|png|webp)$/.test(key)) throw new Error("Archivo no válido.");
  return join(importRoot(), key);
}
export async function receiveImport(request: Request, extension: string, maximum: number) {
  if (!request.body) throw new ImageError(400, "Selecciona un archivo.");
  if (Number(request.headers.get("content-length")) > maximum) throw new ImageError(413, "El archivo supera el tamaño permitido.");
  await mkdir(importRoot(), { recursive: true, mode: 0o700 });
  const space = await statfs(importRoot());
  const reservation = Number(request.headers.get("content-length")) || maximum;
  if (space.bavail * space.bsize < reservation + 1024 ** 3) throw new ImageError(507, "No hay suficiente espacio de trabajo para recibir la carga.");
  const key = `${randomUUID()}.${extension}`;
  let bytes = 0;
  const meter = new Transform({ transform(chunk, _encoding, callback) {
    bytes += chunk.length;
    callback(bytes > maximum ? new ImageError(413, "El archivo supera el tamaño permitido.") : null, chunk);
  } });
  try {
    await pipeline(Readable.fromWeb(request.body as import("node:stream/web").ReadableStream), meter, createWriteStream(sourcePath(key), { flags: "wx", mode: 0o600 }), { signal: AbortSignal.timeout(3600_000) });
    if (!bytes) throw new ImageError(400, "El archivo está vacío.");
    return key;
  } catch (cause) { await unlink(sourcePath(key)).catch(() => {}); throw cause; }
}
