import type { FileHandle } from "node:fs/promises";
import { childDirectory } from "./filesystem";

const uuid = "[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}";
const folderPattern = new RegExp(`^${uuid}_${uuid}$`);

export async function repairNfsImageFolders(root: FileHandle, folderNames: string[], groupId: number) {
  if (!Number.isInteger(groupId) || groupId < 1000 || groupId > 1999) throw new Error("GID de imágenes inválido.");
  if ((await root.stat()).gid !== groupId) throw new Error("El GID de la raíz NFS no coincide con el grupo de imágenes.");
  let repaired = 0, missing = 0;
  for (const name of new Set(folderNames)) {
    if (!folderPattern.test(name)) throw new Error("Nombre de carpeta de validación inválido.");
    let folder: FileHandle;
    try { folder = await childDirectory(root, name, false); }
    catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === "ENOENT") { missing++; continue; }
      throw cause;
    }
    try {
      if ((await folder.stat()).gid !== groupId) await folder.chown(-1, groupId);
      await folder.chmod(0o2770);
      const inbox = await childDirectory(folder, "por_procesar", true, 0o2770);
      await inbox.close();
      repaired++;
    } finally { await folder.close(); }
  }
  return { repaired, missing };
}
