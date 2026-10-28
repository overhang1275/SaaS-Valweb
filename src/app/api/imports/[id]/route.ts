import { revalidatePath } from "next/cache";
import { getActor } from "@/lib/auth";
import { getImport, jobDto, configureImport, publishCsv, retryImport, cancelImport } from "@/features/imports/service";
import { readBoundedJson } from "@/lib/request-json";
import { z } from "zod";
import { limitRequest } from "@/features/identity/rate-limit";

export const runtime = "nodejs";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await getActor(); if (!actor) return Response.json({ message: "Inicia sesión." }, { status: 401 });
    return Response.json(jobDto(await getImport(actor, (await params).id)), { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ message: "Importación no disponible." }, { status: 404 }); }
}
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL!).origin) return Response.json({ message: "Origen no permitido." }, { status: 403 });
    const actor = await getActor(); if (!actor) return Response.json({ message: "Inicia sesión." }, { status: 401 });
    if (!await limitRequest("import-commands", actor.id, 60, 60)) return Response.json({ message: "Demasiadas operaciones. Espera un minuto." }, { status: 429 });
    if (Number(request.headers.get("content-length")) > 8192) return Response.json({ message: "Solicitud demasiado grande." }, { status: 413 });
    const { id } = await params; const job = await getImport(actor, id);
    const body = z.object({ action: z.string(), mapping: z.unknown().optional(), mode: z.string().optional(), replaceImages: z.boolean().optional() }).parse(await readBoundedJson(request));
    if (body.action === "configure") await configureImport(actor, id, body);
    else if (body.action === "publish") await publishCsv(actor, id);
    else if (body.action === "retry") await retryImport(actor, id, body.replaceImages === true);
    else if (body.action === "cancel") await cancelImport(actor, id);
    else return Response.json({ message: "Operación no válida." }, { status: 400 });
    revalidatePath(`/validaciones/${job.validationId}/editar`); revalidatePath("/validaciones");
    return Response.json(jobDto(await getImport(actor, id)));
  } catch { return Response.json({ message: "No se pudo completar el cambio. Revisa el mapeo y el estado de la importación; si cambió la base, vuelve a importarla." }, { status: 400 }); }
}
