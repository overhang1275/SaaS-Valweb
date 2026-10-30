"use server";

import { revalidatePath } from "next/cache";
import { ZodError, z } from "zod";
import { getActor } from "@/lib/auth";
import type { ActionState } from "@/lib/action-state";
import { limitRequest } from "@/features/identity/rate-limit";
import { consumeAccessToken, createTenant, inviteConsultationUser, inviteUser, requestPasswordReset, revokeUserSessions, saveConsultationUserValidations, setTenantStatus, setUserStatus, updateTenantName } from "@/features/identity/service";

const value = (form: FormData, key: string) => String(form.get(key) ?? "");
const success = (message: string): ActionState => ({ status: "success", message });
const error = (message: string): ActionState => ({ status: "error", message });

function userMessage(cause: unknown) {
  if (cause instanceof Error && cause.message === "El correo SMTP no está configurado.") return "El envío de correo no está habilitado. Revisa la configuración del servicio de correo.";
  if (cause instanceof ZodError) return "Revisa los datos. Usa un correo válido, nombres de hasta 120 caracteres y contraseñas de 12 a 128 caracteres.";
  const known = ["El correo SMTP no está configurado.", "Selecciona una cuenta activa.", "Selecciona al menos una validación protegida.", "No puedes desactivar tu propio acceso.", "El usuario debe activar su invitación.", "El enlace no es válido o ha caducado.", "El acceso no está disponible.", "Selecciona únicamente validaciones protegidas de la cuenta indicada.", "No se encontró el usuario de consulta."];
  return cause instanceof Error && known.includes(cause.message) ? cause.message : "No se pudo completar la operación. Revisa los datos e inténtalo de nuevo.";
}

async function adminMutation(work: (actor: NonNullable<Awaited<ReturnType<typeof getActor>>>) => Promise<unknown>, message: string): Promise<ActionState> {
  const actor = await getActor();
  if (!actor || actor.role !== "ADMIN") return error("Tu sesión no permite realizar esta acción. Vuelve a iniciar sesión.");
  if (!await limitRequest("admin", actor.id, 60, 60)) return error("Demasiadas operaciones. Espera un minuto.");
  try { await work(actor); } catch (cause) { return error(userMessage(cause)); }
  revalidatePath("/admin/clientes");
  revalidatePath("/admin/usuarios");
  revalidatePath("/dashboard");
  return success(message);
}

export async function createTenantAction(_: ActionState, form: FormData) {
  return adminMutation(actor => createTenant(actor, { name: value(form, "name") }), "Cuenta creada. Ya puedes invitar a su equipo.");
}

export async function updateTenantNameAction(_: ActionState, form: FormData) {
  const id = value(form, "id"), name = value(form, "name").trim();
  if (!z.uuid().safeParse(id).success) return error("La cuenta seleccionada no es válida.");
  if (!name || name.length > 120) return { ...error("Escribe un nombre de cuenta de hasta 120 caracteres."), fieldErrors: { name: "Escribe un nombre de cuenta de hasta 120 caracteres." } };
  return adminMutation(actor => updateTenantName(actor, id, { name }), "Nombre de la cuenta actualizado.");
}

export async function tenantStatusAction(_: ActionState, form: FormData) {
  const status = value(form, "status");
  if (status !== "ACTIVE" && status !== "SUSPENDED") return error("Estado no válido.");
  return adminMutation(actor => setTenantStatus(actor, value(form, "id"), status), status === "ACTIVE" ? "Cuenta reactivada. Sus usuarios deben iniciar sesión de nuevo." : "Cuenta suspendida. Se revocó el acceso de sus usuarios.");
}

export async function inviteUserAction(_: ActionState, form: FormData) {
  return adminMutation(actor => inviteUser(actor, { name: value(form, "name"), email: value(form, "email"), tenantId: value(form, "tenantId") }), "Invitación agregada a la cola de correo. El enlace vence en 48 horas.");
}

export async function inviteConsultationUserAction(_: ActionState, form: FormData) {
  return adminMutation(actor => inviteConsultationUser(actor, { name: value(form, "name"), email: value(form, "email"), tenantId: value(form, "tenantId"), validationIds: form.getAll("validationIds").map(String).filter(Boolean) }), "Invitación enviada. La persona podrá consultar solo las validaciones seleccionadas.");
}

export async function consultationUserValidationsAction(_: ActionState, form: FormData) {
  return adminMutation(actor => saveConsultationUserValidations(actor, value(form, "id"), form.getAll("validationIds").map(String).filter(Boolean)), "Permisos de consulta actualizados.");
}

export async function userStatusAction(_: ActionState, form: FormData) {
  const status = value(form, "status");
  if (status !== "ACTIVE" && status !== "DISABLED") return error("Estado no válido.");
  return adminMutation(actor => setUserStatus(actor, value(form, "id"), status), "Acceso actualizado. Las sesiones anteriores se revocaron.");
}

export async function revokeSessionsAction(_: ActionState, form: FormData) {
  return adminMutation(actor => revokeUserSessions(actor, value(form, "id")), "Sesiones revocadas.");
}

export async function resetPasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  const email = value(form, "email").trim().toLowerCase();
  if (email.length > 254) return error("Introduce un correo válido.");
  if (!await limitRequest("reset-global", "all", 60, 3600)) return error("Demasiadas solicitudes. Inténtalo más tarde.");
  if (await limitRequest("reset-email", email, 3, 3600)) {
    try { await requestPasswordReset(email); } catch { console.error("PASSWORD_RESET_QUEUE_FAILED"); }
  }
  return success("Si el correo tiene acceso activo, recibirás un enlace para establecer una nueva contraseña.");
}

export async function setPasswordAction(_: ActionState, form: FormData): Promise<ActionState> {
  if (!await limitRequest("token-global", "all", 30, 60)) return error("Demasiados intentos. Espera un minuto.");
  if (value(form, "password") !== value(form, "confirmPassword")) return error("Las contraseñas no coinciden.");
  try { await consumeAccessToken(value(form, "token"), value(form, "password")); }
  catch (cause) { return error(userMessage(cause)); }
  return success("Contraseña guardada. Ya puedes iniciar sesión.");
}
