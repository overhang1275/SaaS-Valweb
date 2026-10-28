import { mkdir, readFile, writeFile, unlink, readdir, stat } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { resolve, join, sep } from "node:path";

const keyPattern = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}\.webp$/;
function root() {
  const directory = resolve(process.env.IMAGE_STORAGE_DIR || join(process.cwd(), "var", "assets"));
  const publicDirectory = resolve(process.cwd(), "public");
  if (directory === publicDirectory || directory.startsWith(`${publicDirectory}${sep}`)) throw new Error("El almacenamiento de imágenes debe estar fuera de public/.");
  return directory;
}
function filePath(key: string) {
  if (!keyPattern.test(key)) throw new Error("Clave de imagen no válida.");
  return join(root(), key);
}

export async function writeImageFile(data: Buffer) {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  const key = `${randomUUID()}.webp`;
  await writeFile(filePath(key), data, { flag: "wx", mode: 0o600 });
  return key;
}
export async function readImageFile(key: string) { return readFile(filePath(key)); }
export async function removeImageFile(key: string) {
  try { await unlink(filePath(key)); }
  catch (cause) { if ((cause as NodeJS.ErrnoException).code !== "ENOENT") throw cause; }
}

export async function purgeOrphanImages(referenced: Set<string>) {
  await mkdir(root(), { recursive: true, mode: 0o700 });
  let removed = 0;
  for (const entry of await readdir(root(), { withFileTypes: true })) {
    if (!entry.isFile() || !keyPattern.test(entry.name) || referenced.has(entry.name)) continue;
    const details = await stat(filePath(entry.name));
    if (details.mtimeMs > Date.now() - 24 * 3600_000) continue;
    await removeImageFile(entry.name);
    removed++;
  }
  return removed;
}
