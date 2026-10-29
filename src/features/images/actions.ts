"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActor } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { limitRequest } from "@/features/identity/rate-limit";
import { ImageError } from "./limits";
import { createValidationImageFolder, saveGlobalImageLocation, selectValidationImageStorage } from "./locations";

async function storageActor() {
  const actor = await getActor();
  if (!actor) throw new ImageError(401, "Inicia sesión para configurar el almacenamiento.");
  if (!await limitRequest("image-storage", actor.id, 30, 60)) throw new ImageError(429, "Hay demasiadas operaciones. Espera un minuto.");
  return actor;
}
function failure(cause: unknown): ActionState {
  return { status: "error", message: cause instanceof ImageError ? cause.message
    : cause instanceof z.ZodError ? "Revisa el destino y los datos del formulario."
    : "No se pudo completar la operación. Comprueba tu acceso y el estado del almacenamiento." };
}
function refreshValidation(id: string) {
  revalidatePath(`/validaciones/${id}/editar`);
  revalidatePath(`/validaciones/${id}/imagenes`);
}
export async function saveGlobalImageLocationAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await storageActor();
    if (actor.role !== "ADMIN") throw new ImageError(403, "Solo un administrador puede configurar las rutas globales.");
    await saveGlobalImageLocation(actor, { kind: form.get("kind"), rootPath: form.get("rootPath") });
    revalidatePath("/admin/ajustes");
    revalidatePath("/validaciones/[id]/editar", "page");
    return { status: "success", message: "Destino guardado y acceso verificado." };
  } catch (cause) { return failure(cause); }
}
export async function selectValidationImageStorageAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await storageActor();
    const id = z.uuid().parse(form.get("id")), kind = z.enum(["LOCAL", "NFS"]).parse(form.get("kind"));
    await selectValidationImageStorage(actor, id, kind);
    refreshValidation(id);
    return { status: "success", message: "Destino seleccionado." };
  } catch (cause) { return failure(cause); }
}
export async function createValidationImageFolderAction(_: ActionState, form: FormData): Promise<ActionState> {
  try {
    const actor = await storageActor();
    const id = z.uuid().parse(form.get("id"));
    await createValidationImageFolder(actor, id);
    refreshValidation(id);
    return { status: "success", message: "La carpeta está preparada." };
  } catch (cause) { return failure(cause); }
}
