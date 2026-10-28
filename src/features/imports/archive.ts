import { basename, isAbsolute } from "node:path";
import { openPromise, type Entry } from "yauzl";
import { imageAlfanum } from "@/features/records/alfanum";
import { ImageError, MAX_IMAGE_BYTES } from "@/features/images/limits";

export const MAX_EXPANDED_BYTES = Number(process.env.MAX_EXPANDED_BYTES || 100 * 1024 ** 3);
export function archiveEntryName(entry: Entry) {
  const parts = entry.fileName.split("/");
  const name = basename(entry.fileName).slice(0, 200);
  if (isAbsolute(entry.fileName) || parts.includes("..")) throw new ImageError(400, `${name}: la entrada del ZIP contiene una ruta absoluta o un recorrido fuera de la carpeta (..).`);
  if (entry.isEncrypted()) throw new ImageError(400, `${name}: el archivo está cifrado. Crea un ZIP sin contraseña.`);
  if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000) throw new ImageError(400, `${name}: la entrada es un enlace simbólico, no un archivo de imagen.`);
  if (entry.fileName.endsWith("/") || parts.includes("__MACOSX") || basename(entry.fileName).startsWith(".")) return null;
  if (entry.uncompressedSize > MAX_IMAGE_BYTES) throw new ImageError(413, `${name}: pesa ${entry.uncompressedSize} bytes descomprimido y supera el límite de 10 MiB por imagen.`);
  if (entry.uncompressedSize > 1024 ** 2 && entry.uncompressedSize / Math.max(entry.compressedSize, 1) > 200) throw new ImageError(400, `${name}: la proporción de compresión supera 200:1; se rechazó para limitar la expansión del ZIP.`);
  if (!/\.(jpg|jpeg|png|webp)$/i.test(name)) throw new ImageError(400, `${name}: extensión no permitida. El ZIP debe contener imágenes JPG, JPEG, PNG o WebP.`);
  try { return imageAlfanum(entry.fileName); }
  catch { throw new ImageError(400, `${name}: el nombre sin extensión debe tener entre 1 y 128 letras ASCII o números, sin espacios ni símbolos.`); }
}
export async function inspectImageArchive(path: string) {
  const zip = await openPromise(path, { lazyEntries: true, validateEntrySizes: true, strictFileNames: true });
  const names = new Set<string>(); let bytes = 0;
  try {
    if (zip.entryCount > 100000) throw new ImageError(400, `El ZIP contiene ${zip.entryCount} entradas; el límite es 100000, incluidas las carpetas.`);
    for await (const entry of zip.eachEntry()) {
      const name = archiveEntryName(entry); if (!name) continue;
      if (names.has(name)) throw new ImageError(400, `${basename(entry.fileName).slice(0, 200)}: alfanumérico repetido en el ZIP: ${name}. Dos nombres que solo cambian mayúsculas o extensión corresponden al mismo código.`);
      names.add(name); bytes += entry.uncompressedSize;
      if (names.size > 50000) throw new ImageError(400, "El ZIP supera el límite de 50000 imágenes por lote.");
      if (bytes > MAX_EXPANDED_BYTES) throw new ImageError(413, `El ZIP supera el límite de ${MAX_EXPANDED_BYTES} bytes descomprimidos.`);
    }
    if (!names.size) throw new ImageError(400, "El ZIP no contiene imágenes: está vacío o solo incluye carpetas y archivos ocultos.");
    return { files: names.size, bytes };
  } finally { zip.close(); }
}
