import { revalidatePath } from "next/cache";
import sharp from "sharp";
import { getActor } from "@/lib/auth";
import { getRecordImage, deleteRecordImage, replaceRecordImage } from "@/features/records/images";
import { readImageFile } from "@/features/images/storage";
import { ImageError, MAX_IMAGE_PIXELS } from "@/features/images/limits";
import { readImageBody, reserveImageUpload } from "@/features/images/processing";
import { limitRequest } from "@/features/identity/rate-limit";

type Context = { params: Promise<{ id: string; imageId: string }> };
export const runtime = "nodejs";
const privateHeaders = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
let thumbnails = 0;
const thumbnailQueue: Array<() => void> = [];

async function thumbnail(key: string) {
  if (thumbnails >= 2) {
    if (thumbnailQueue.length >= 64) throw new ImageError(429, "Hay otras imágenes cargándose. Inténtalo de nuevo.");
    await new Promise<void>(resolve => thumbnailQueue.push(resolve));
  } else thumbnails++;
  try {
    return await sharp(await readImageFile(key), { limitInputPixels: MAX_IMAGE_PIXELS, sequentialRead: true })
      .timeout({ seconds: 10 }).resize({ width: 320, height: 240, fit: "inside", withoutEnlargement: true }).webp({ quality: 72 }).toBuffer();
  } finally {
    const next = thumbnailQueue.shift();
    if (next) next(); else thumbnails--;
  }
}

async function mutation(request: Request, context: Context) {
  const configured = process.env.NEXTAUTH_URL;
  if (!configured || request.headers.get("origin") !== new URL(configured).origin) throw new ImageError(403, "Origen no permitido.");
  const actor = await getActor();
  if (!actor) throw new ImageError(401, "Inicia sesión para gestionar las imágenes.");
  const { id, imageId } = await context.params;
  if (!await getRecordImage(actor, id, imageId)) throw new ImageError(404, "La imagen no está disponible.");
  if (!await limitRequest("images", actor.id, 10, 60)) throw new ImageError(429, "Demasiadas operaciones de imagen. Espera un minuto.");
  return { actor, id, imageId };
}
function failure(cause: unknown) {
  const status = cause instanceof ImageError ? cause.status : 404;
  const message = cause instanceof ImageError ? cause.message : "La imagen no está disponible. Recarga el catálogo e inténtalo de nuevo.";
  return Response.json({ message }, { status, headers: { ...privateHeaders, ...(status === 429 ? { "Retry-After": "60" } : {}) } });
}
function refresh(id: string) {
  revalidatePath(`/validaciones/${id}/editar`);
  revalidatePath(`/validaciones/${id}/imagenes`);
  revalidatePath("/validaciones");
}

export async function GET(request: Request, context: Context) {
  try {
    const actor = await getActor();
    if (!actor) throw new ImageError(401, "Inicia sesión para ver la imagen.");
    const { id, imageId } = await context.params;
    const image = await getRecordImage(actor, id, imageId);
    if (!image) throw new ImageError(404, "La imagen no está disponible.");
    const data = new URL(request.url).searchParams.get("thumbnail") === "1" ? await thumbnail(image.storageKey) : await readImageFile(image.storageKey);
    return new Response(new Uint8Array(data), { headers: { ...privateHeaders, "Content-Type": "image/webp" } });
  } catch (cause) { return failure(cause); }
}

export async function POST(request: Request, context: Context) {
  let release: (() => void) | undefined;
  try {
    const { actor, id, imageId } = await mutation(request, context);
    const version = request.headers.get("x-image-version") ?? "";
    if (!version) throw new ImageError(400, "Recarga el catálogo antes de reemplazar la imagen.");
    release = reserveImageUpload();
    const body = await readImageBody(request);
    await replaceRecordImage(actor, id, imageId, body, new URL(request.url).searchParams.get("filename") ?? "", request.headers.get("content-type") ?? "", version);
    refresh(id);
    return Response.json({ message: "Imagen reemplazada. El alfanumérico y el folio conservan su relación." }, { headers: privateHeaders });
  } catch (cause) { return failure(cause); }
  finally { release?.(); }
}

export async function DELETE(request: Request, context: Context) {
  try {
    const { actor, id, imageId } = await mutation(request, context);
    await deleteRecordImage(actor, id, imageId, request.headers.get("x-confirm-deactivation") === "true");
    refresh(id);
    return Response.json({ message: "Imagen eliminada; revisa la disponibilidad antes de activar." }, { headers: privateHeaders });
  } catch (cause) { return failure(cause); }
}
