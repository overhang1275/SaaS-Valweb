"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { ZodError } from "zod";
import { getActor } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { limitRequest } from "@/features/identity/rate-limit";
import { createValidation, updateValidation, deleteValidation, setValidationStatus } from "./service";
import { updatePublicSettings } from "@/features/records/settings";

const value = (form: FormData, key: string) => String(form.get(key) ?? "");
const readTexts = (form: FormData) => ({
  name: value(form, "name"),
  title: value(form, "title"),
  instructions: value(form, "instructions"),
  successMessage: value(form, "successMessage"),
  errorMessage: value(form, "errorMessage"),
  imageAlt: value(form, "imageAlt"),
  ...(value(form, "imageMode") ? { imageMode: value(form, "imageMode") as "SHARED" | "PER_RECORD" } : {}),
});

function failure(cause: unknown): ActionState {
  if (cause instanceof ZodError) {
    return {
      status: "error",
      message: "Revisa los campos indicados. Tus cambios siguen en el formulario.",
      fieldErrors: Object.fromEntries(cause.issues.map(issue => [String(issue.path[0]), "Revisa este campo y su límite de caracteres."])),
    };
  }
  const known = ["Selecciona una cuenta activa.", "La validación no está disponible.", "Para activar necesitas una cuenta activa, una imagen y folios publicados."];
  return {
    status: "error",
    message: cause instanceof Error && known.includes(cause.message)
      ? cause.message : "No se pudo completar el cambio. Comprueba tu acceso e inténtalo de nuevo.",
  };
}

async function mutationActor() {
  const actor = await getActor();
  if (!actor) return null;
  return await limitRequest("validations", actor.id, 60, 60) ? actor : null;
}

const denied: ActionState = { status: "error", message: "Tu sesión no permite esta operación o has hecho demasiados cambios. Vuelve a iniciar sesión o espera un minuto." };

export async function createValidationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const actor = await mutationActor();
  if (!actor) return denied;
  let id: string;
  try {
    const tenantId = value(form, "tenantId");
    const row = await createValidation(actor, { ...readTexts(form), ...(tenantId ? { tenantId } : {}) });
    id = row.id;
  } catch (cause) { return failure(cause); }
  revalidatePath("/validaciones");
  redirect(`/validaciones/${id}/editar?creada=1`);
}

export async function updateValidationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const actor = await mutationActor();
  if (!actor) return denied;
  const id = value(form, "id");
  try { await updateValidation(actor, id, readTexts(form)); }
  catch (cause) { return failure(cause); }
  revalidatePath("/validaciones");
  revalidatePath(`/validaciones/${id}/editar`);
  return { status: "success", message: "Cambios guardados. El enlace público se conserva." };
}

export async function deleteValidationAction(_: ActionState, form: FormData): Promise<ActionState> {
  const actor = await mutationActor();
  if (!actor) return denied;
  try { await deleteValidation(actor, value(form, "id")); }
  catch (cause) { return failure(cause); }
  revalidatePath("/validaciones");
  redirect("/validaciones?eliminada=1");
}

export async function validationStatusAction(_: ActionState, form: FormData): Promise<ActionState> {
  const actor = await mutationActor();
  if (!actor) return denied;
  const status = value(form, "status");
  if (status !== "ACTIVE" && status !== "INACTIVE") return { status: "error", message: "El estado no es válido." };
  const id = value(form, "id");
  try { await setValidationStatus(actor, id, status); }
  catch (cause) { return failure(cause); }
  revalidatePath("/validaciones");
  revalidatePath(`/validaciones/${id}/editar`);
  return { status: "success", message: status === "ACTIVE" ? "Validación activada." : "Validación desactivada." };
}

export async function publicSettingsAction(_: ActionState, form: FormData): Promise<ActionState> {
  const actor = await mutationActor(); if (!actor) return denied;
  const id = value(form, "id");
  try { await updatePublicSettings(actor, id, { imageMode: value(form, "imageMode"), showFolio: form.get("showFolio") === "on", showAlfanum: form.get("showAlfanum") === "on", showTipo: form.get("showTipo") === "on", showOtro: form.get("showOtro") === "on", showImage: form.get("showImage") === "on" }); }
  catch (cause) { return failure(cause); }
  revalidatePath(`/validaciones/${id}/editar`);
  return { status: "success", message: "Resultado configurado. Si estaba activa, revisa los requisitos y vuelve a activarla." };
}
