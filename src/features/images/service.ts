import { prisma } from "@/lib/prisma";
import { currentActor, type Actor } from "@/features/identity/service";
import { getValidation, lockValidation } from "@/features/validations/service";
import { ImageError } from "./limits";
import { prepareImage } from "./processing";
import { writeImageFile, removeImageFile } from "./storage";

async function retireImage(key: string | null) {
  if (!key) return;
  try { await removeImageFile(key); }
  catch { console.error("IMAGE_CLEANUP_FAILED"); }
}

export async function replaceValidationImage(actor: Actor, id: string, input: Buffer, filename: string, mime: string) {
  if (!await getValidation(actor, id)) throw new ImageError(404, "La validación no está disponible.");
  const image = await prepareImage(input, filename, mime);
  const key = await writeImageFile(image.data);
  let previous: string | null;
  try {
    previous = await prisma.$transaction(async tx => {
      const user = await currentActor(tx, actor);
      const row = await lockValidation(tx, user, id);
      await tx.validation.update({ where: { id }, data: { imageKey: key, imageMime: "image/webp", imageSize: image.data.length, imageWidth: image.width, imageHeight: image.height } });
      await tx.auditLog.create({ data: { actorId: user.id, tenantId: row.tenantId, targetId: id, action: "VALIDATION_IMAGE_REPLACED" } });
      return row.imageKey;
    });
  } catch (cause) {
    // A lost commit acknowledgement must not delete an image already linked by PostgreSQL.
    try {
      const linked = await prisma.validation.findFirst({ where: { imageKey: key }, select: { id: true } });
      if (!linked) await retireImage(key);
    } catch { console.error("IMAGE_ORPHAN_RETAINED"); }
    throw cause;
  }
  await retireImage(previous);
}

export async function deleteValidationImage(actor: Actor, id: string, confirmDeactivate: boolean) {
  const previous = await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const row = await lockValidation(tx, user, id);
    if (row.status === "ACTIVE" && !confirmDeactivate) throw new ImageError(409, "Confirma la desactivación antes de eliminar la imagen de una validación activa.");
    await tx.validation.update({ where: { id }, data: { imageKey: null, imageMime: null, imageSize: null, imageWidth: null, imageHeight: null, ...(row.status === "ACTIVE" ? { status: "INACTIVE" } : {}) } });
    await tx.auditLog.create({ data: { actorId: user.id, tenantId: row.tenantId, targetId: id, action: "VALIDATION_IMAGE_DELETED", metadata: { deactivated: row.status === "ACTIVE" } } });
    return row.imageKey;
  });
  await retireImage(previous);
}
