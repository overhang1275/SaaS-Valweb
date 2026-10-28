"use server";

import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
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
