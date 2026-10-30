import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { currentActor, type Actor } from "@/features/identity/service";
import { lockValidation } from "@/features/validations/service";

export const publicSettingsSchema = z.object({ imageMode: z.enum(["SHARED", "PER_RECORD"]), showFolio: z.boolean(), showAlfanum: z.boolean(), showTipo: z.boolean(), showOtro: z.boolean(), showImage: z.boolean(), requireClientAccess: z.boolean().optional() });
export async function updatePublicSettings(actor: Actor, id: string, input: unknown) {
  const data = publicSettingsSchema.parse(input);
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor, true);
    const row = await lockValidation(tx, user, id);
    const requireClientAccess = data.requireClientAccess ?? row.requireClientAccess;
    const resultChanged = row.imageMode !== data.imageMode || row.showFolio !== data.showFolio || row.showAlfanum !== data.showAlfanum || row.showTipo !== data.showTipo || row.showOtro !== data.showOtro || row.showImage !== data.showImage;
    await tx.validation.update({ where: { id }, data: { ...data, requireClientAccess, ...(row.status === "ACTIVE" && resultChanged ? { status: "INACTIVE" } : {}) } });
    await tx.auditLog.create({ data: { actorId: user.id, tenantId: row.tenantId, targetId: id, action: "PUBLIC_RESULT_CONFIGURED" } });
    return { resultChanged, requireClientAccess };
  });
}
