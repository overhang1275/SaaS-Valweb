import { basename, extname } from "node:path";
import { z } from "zod";
import { getActor } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getValidation, lockValidation } from "@/features/validations/service";
import { currentActor } from "@/features/identity/service";
import { limitRequest } from "@/features/identity/rate-limit";
import { receiveImport, MAX_CSV_BYTES, MAX_ZIP_BYTES } from "@/features/imports/files";
import { enqueueImport } from "@/features/imports/queue";
import { jobDto, listImports } from "@/features/imports/service";
import { ImageError, MAX_IMAGE_BYTES } from "@/features/images/limits";
import { lockImageLocation } from "@/features/images/storage";

export const runtime = "nodejs";
let uploads = 0;
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(); if (!actor) return Response.json({ message: "Inicia sesión." }, { status: 401 });
    const parsed = z.enum(["CSV", "IMAGES"]).optional().safeParse(new URL(request.url).searchParams.get("kind") ?? undefined);
    if (!parsed.success) return Response.json({ message: "El tipo de carga no es válido." }, { status: 400 });
    return Response.json(await listImports(actor, (await params).id, parsed.data), { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ message: "Validación no disponible." }, { status: 404 }); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  let reserved = false;
  try {
    if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL!).origin) return Response.json({ message: "Origen no permitido." }, { status: 403 });
    const actor = await getActor(); if (!actor) return Response.json({ message: "Inicia sesión." }, { status: 401 });
    if (actor.role !== "ADMIN") return Response.json({ message: "Solo un administrador puede cargar registros o imágenes." }, { status: 403 });
    const { id } = await params;
    if (!await getValidation(actor, id)) return Response.json({ message: "Validación no disponible." }, { status: 404 });
    if (!await limitRequest("import-upload", actor.id, 10, 3600) || uploads >= 2) return Response.json({ message: "Hay demasiadas cargas. Reintenta en unos minutos." }, { status: 429 });
    const url = new URL(request.url);
    const originalName = basename(url.searchParams.get("filename") ?? "");
    const extension = extname(originalName).slice(1).toLowerCase();
    const kind = url.searchParams.get("kind");
    if (originalName.length > 200 || (kind !== "CSV" && kind !== "IMAGES") || (kind === "CSV" ? extension !== "csv" : !["zip", "jpg", "jpeg", "png", "webp"].includes(extension))) return Response.json({ message: "Selecciona un CSV para registros o ZIP/JPG/PNG/WebP para imágenes." }, { status: 400 });
    uploads++; reserved = true;
    const sourceKey = await receiveImport(request, extension, kind === "CSV" ? MAX_CSV_BYTES : extension === "zip" ? MAX_ZIP_BYTES : MAX_IMAGE_BYTES);
    const job = await prisma.$transaction(async tx => {
      const user = await currentActor(tx, actor); const validation = await lockValidation(tx, user, id);
      if (kind === "IMAGES" && validation.imageStorageKind) await lockImageLocation(tx, validation.imageStorageKind);
      return tx.importJob.create({ data: { tenantId: validation.tenantId, validationId: id, requestedById: user.id, kind, imageStorageKind: kind === "IMAGES" ? validation.imageStorageKind : null, sourceKey, originalName, replaceImages: url.searchParams.get("replace") === "true" } });
    });
    try { await enqueueImport(job.id); } catch { await prisma.importJob.update({ where: { id: job.id }, data: { phase: "Pendiente de encolar. Usa reintentar." } }); }
    return Response.json(jobDto(job), { status: 202 });
  } catch (cause) {
    if (cause instanceof ImageError) return Response.json({ message: cause.message }, { status: cause.status });
    console.error("IMPORT_UPLOAD_FAILED");
    return Response.json({ message: "No se pudo recibir la carga. Comprueba tu conexión y el espacio disponible." }, { status: 500 });
  } finally { if (reserved) uploads--; }
}
