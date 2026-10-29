import { mkdir, open, readdir, statfs, unlink, type FileHandle } from "node:fs/promises";
import { constants } from "node:fs";
import { randomUUID } from "node:crypto";
import { isAbsolute, join, resolve, sep } from "node:path";
import { importRoot } from "@/features/imports/files";
import { ImageError } from "./limits";
import type { StorageKind } from "@/generated/prisma/client";

export function pathsOverlap(first: string, second: string) {
  return first === second || first.startsWith(second.endsWith(sep) ? second : second + sep) || second.startsWith(first.endsWith(sep) ? first : first + sep);
}
export function imageRootPath(input: string) {
  if (!input || !isAbsolute(input) || /[\p{Cc}\p{Cf}]/u.test(input) || input.length > 4096) throw new ImageError(400, "Indica una ruta absoluta sin caracteres de control u ocultos.");
  const path = resolve(input);
  if ([process.cwd(), importRoot(), "/etc", "/proc", "/sys", "/dev", "/usr", "/bin", "/sbin", "/boot"].some(forbidden => pathsOverlap(path, resolve(forbidden)))) throw new ImageError(400, "El almacenamiento debe estar separado del código, configuración, directorios del sistema y cargas temporales.");
  return path;
}
export function handlePath(handle: FileHandle) { return `/proc/self/fd/${handle.fd}`; }
export async function childDirectory(parent: FileHandle, name: string, create: boolean) {
  const path = join(handlePath(parent), name);
  if (create) {
    try { await mkdir(path, { mode: 0o700 }); }
    catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "EEXIST") throw cause; }
  }
  return open(path, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
}
export async function openDirectory(path: string, create: boolean) {
  let handle = await open("/", constants.O_RDONLY | constants.O_DIRECTORY);
  try {
    for (const part of path.split(sep).filter(Boolean)) {
      const next = await childDirectory(handle, part, create);
      await handle.close();
      handle = next;
    }
    return handle;
  } catch (cause) { await handle.close(); throw cause; }
}
export async function openImageStorageRoot(rootPath: string, kind: StorageKind, probe = false) {
  const path = imageRootPath(rootPath);
  let handle: FileHandle | undefined;
  try {
    handle = await openDirectory(path, false);
    const space = await statfs(handlePath(handle));
    if (kind === "NFS" && space.type !== 0x6969) throw new ImageError(503, "El almacenamiento NFS no está montado o no está disponible.");
    if (probe) {
      if (space.bavail <= 0) throw new ImageError(507, "El destino no tiene espacio disponible.");
      await readdir(handlePath(handle));
      const filename = join(handlePath(handle), `.valweb-probe-${randomUUID()}`);
      const file = await open(filename, constants.O_RDWR | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
      try {
        const data = Buffer.from("Valweb storage check");
        await file.writeFile(data);
        const copy = Buffer.alloc(data.length);
        await file.read(copy, 0, copy.length, 0);
        if (!copy.equals(data)) throw new ImageError(503, "No se pudo verificar la lectura del destino.");
      } finally { try { await file.close(); } finally { await unlink(filename); } }
    }
    return handle;
  } catch (cause) {
    await handle?.close();
    if (cause instanceof ImageError) throw cause;
    throw new ImageError(503, "No se pudo acceder al destino. Comprueba que exista, sus permisos y el montaje.");
  }
}
