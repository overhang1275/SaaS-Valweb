import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActor } from "@/lib/auth";
import { getValidation } from "@/features/validations/service";
import { limitRequest } from "@/features/identity/rate-limit";
import { ImageError } from "@/features/images/limits";
import { readImageBody, reserveImageUpload } from "@/features/images/processing";
import { replaceValidationImage, deleteValidationImage } from "@/features/images/service";
import { readImageFile } from "@/features/images/storage";

export const runtime = "nodejs";
type Context = { params: Promise<{ id: string }> };

async function authorized(context: Context) {
  const actor = await getActor();
  if (!actor) throw new ImageError(401, "Inicia sesión para gestionar la imagen.");
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) throw new ImageError(404, "La validación no está disponible.");
  const row = await getValidation(actor, id);
  if (!row) throw new ImageError(404, "La validación no está disponible.");
  return { actor, id, row };
}

async function mutation(request: Request, context: Context) {
  const configured = process.env.NEXTAUTH_URL;
  if (!configured || request.headers.get("origin") !== new URL(configured).origin) throw new ImageError(403, "La solicitud no está permitida desde este origen.");
  const result = await authorized(context);
  if (result.actor.role !== "ADMIN") throw new ImageError(403, "Solo un administrador puede cargar o eliminar imágenes.");
  if (!await limitRequest("images", result.actor.id, 10, 60)) throw new ImageError(429, "Demasiadas operaciones de imagen. Espera un minuto.");
  return result;
}

function failure(cause: unknown) {
  if (cause instanceof ImageError) return Response.json({ message: cause.message }, { status: cause.status, headers: { "Cache-Control": "private, no-store", ...(cause.status === 429 ? { "Retry-After": "60" } : {}) } });
  console.error("IMAGE_REQUEST_FAILED");
  return Response.json({ message: "No se pudo completar la operación de imagen. Inténtalo de nuevo." }, { status: 500 });
}
function refresh(id: string) { revalidatePath(`/validaciones/${id}/editar`); revalidatePath("/validaciones"); }

export async function GET(_request: Request, context: Context) {
  try {
    const { row } = await authorized(context);
    if (!row.imageKey) throw new ImageError(404, "La imagen no está disponible.");
    let data: Buffer;
    try { data = await readImageFile(row.imageKey); }
    catch { throw new ImageError(404, "La imagen no está disponible."); }
    return new Response(new Uint8Array(data), { headers: { "Content-Type": "image/webp", "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Content-Disposition": 'inline; filename="validation.webp"' } });
  } catch (cause) { return failure(cause); }
}

export async function POST(request: Request, context: Context) {
  let release: (() => void) | undefined;
  try {
    const { actor, id } = await mutation(request, context);
    release = reserveImageUpload();
    const filename = new URL(request.url).searchParams.get("filename") ?? "";
    const body = await readImageBody(request);
    await replaceValidationImage(actor, id, body, filename, request.headers.get("content-type") ?? "");
    refresh(id);
    return Response.json({ message: "Imagen guardada." });
  } catch (cause) { return failure(cause); }
  finally { release?.(); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { actor, id } = await mutation(request, context);
    const confirmDeactivate = request.headers.get("x-confirm-deactivation") === "true";
    await deleteValidationImage(actor, id, confirmDeactivate);
    refresh(id);
    return Response.json({ message: "Imagen eliminada. Si la validación estaba activa, quedó desactivada." });
  } catch (cause) { return failure(cause); }
}
