import { revalidatePath } from "next/cache";
import { z } from "zod";
import { getActor } from "@/lib/auth";
import { limitRequest } from "@/features/identity/rate-limit";
import { startDirectoryImport, jobDto } from "@/features/imports/service";

export const runtime = "nodejs";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL!).origin) return Response.json({ message: "Origen no permitido." }, { status: 403 });
    const actor = await getActor(); if (!actor) return Response.json({ message: "Inicia sesión." }, { status: 401 });
    if (!await limitRequest("import-upload", actor.id, 10, 3600)) return Response.json({ message: "Hay demasiadas cargas. Reintenta en unos minutos." }, { status: 429 });
    const { id } = await params; z.uuid().parse(id);
    const job = await startDirectoryImport(actor, id);
    revalidatePath(`/validaciones/${id}/editar`);
    return Response.json(jobDto(job), { status: 202, headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ message: "No se pudo iniciar el análisis. Revisa el acceso, el destino y el estado de la carpeta." }, { status: 400 }); }
}
