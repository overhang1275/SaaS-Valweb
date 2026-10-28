"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { prisma } from "@/lib/prisma";
import { limitRequest } from "@/features/identity/rate-limit";
import { sendConfiguredTestEmail } from "@/features/identity/mail";
import { restartImportWorker } from "./service";

export async function restartImportWorkerAction(): Promise<ActionState> {
  try {
    const actor = await getActor();
    if (!actor || actor.role !== "ADMIN") return { status: "error", message: "Solo un administrador puede reiniciar el procesador." };
    await restartImportWorker(actor);
    revalidatePath("/admin/ajustes");
    return { status: "success", message: "Reinicio solicitado. Si hay un lote en proceso, terminará antes de reiniciar. El estado se actualizará automáticamente." };
  } catch (cause) {
    const known = ["El control del procesador no está configurado en este servidor.", "El procesador ya está reiniciándose. Espera a que termine el lote actual.", "Espera un minuto antes de volver a reiniciar el procesador."];
    return { status: "error", message: cause instanceof Error && known.includes(cause.message) ? cause.message : "No se pudo reiniciar el procesador. Comprueba tu acceso o solicita revisar el servicio del servidor." };
  }
}

export async function sendConfiguredTestEmailAction(_: ActionState, _form: FormData): Promise<ActionState> {
  try {
    const actor = await getActor();
    if (!actor || actor.role !== "ADMIN") return { status: "error", message: "Solo un administrador puede probar el correo." };
    if (!await limitRequest("system-email-test", actor.id, 1, 60)) return { status: "error", message: "Espera un minuto antes de volver a enviar una prueba." };
    await prisma.auditLog.create({ data: { actorId: actor.id, targetId: actor.id, action: "SMTP_TEST_EMAIL_REQUESTED" } });
    const recipient = await sendConfiguredTestEmail();
    return { status: "success", message: `El servidor SMTP aceptó el correo de prueba para ${recipient}. Revisa la bandeja de entrada y spam.` };
  } catch (cause) {
    const message = cause instanceof Error && ["El correo SMTP no está configurado.", "El puerto SMTP no es válido."].includes(cause.message)
      ? cause.message
      : "No se pudo enviar la prueba. Revisa la configuración SMTP y vuelve a intentarlo.";
    console.error("SMTP_TEST_EMAIL_FAILED", cause instanceof Error ? cause.name : "unknown");
    return { status: "error", message };
  }
}
