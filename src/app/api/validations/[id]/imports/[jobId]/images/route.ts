import { z } from "zod";
import { getActor } from "@/lib/auth";
import { listImportReplacements } from "@/features/imports/service";

export const runtime = "nodejs";
export async function GET(request: Request, { params }: { params: Promise<{ id: string; jobId: string }> }) {
  try {
    const actor = await getActor(); if (!actor) return Response.json({ message: "Inicia sesión." }, { status: 401 });
    const { id, jobId } = await params; z.uuid().parse(id); z.uuid().parse(jobId);
    const page = z.coerce.number().int().min(1).max(10000).parse(new URL(request.url).searchParams.get("page") ?? "1");
    const job = await listImportReplacements(actor, id, jobId, page);
    return Response.json(job, { headers: { "Cache-Control": "private, no-store" } });
  } catch { return Response.json({ message: "Revisión no disponible." }, { status: 400 }); }
}
