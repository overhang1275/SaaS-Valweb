import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { IMAGE_VIEWER_COOKIE, validViewerSecret } from "@/features/public/viewer-session";
import { z } from "zod";
import { verifyAlfanum } from "@/features/public/service";
import { limitRequest } from "@/features/identity/rate-limit";
import { readBoundedJson } from "@/lib/request-json";
import { PUBLIC_ACCESS_COOKIE, hasPublicAccessForToken } from "@/features/public/access";

export const runtime = "nodejs";
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const headers = { "Cache-Control": "private, no-store" };
  try {
    if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL!).origin) return Response.json({ message: "Origen no permitido." }, { status: 403, headers });
    if (!await limitRequest("public-global", "all", 300, 60)) return Response.json({ message: "Demasiadas solicitudes. Espera un minuto." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    const { token } = await params;
    if (!await hasPublicAccessForToken(token, request.cookies.get(PUBLIC_ACCESS_COOKIE)?.value)) return Response.json({ message: "Inicia sesión para usar esta consulta." }, { status: 401, headers });
    const ip = process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "shared" : "shared";
    if (!await limitRequest("public-lookup", `${token}:${ip}`, 30, 60)) return Response.json({ message: "Demasiados intentos. Espera un minuto." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    const body = z.object({ alfanum: z.string().max(128) }).parse(await readBoundedJson(request, 2048));
    const viewer = validViewerSecret(request.cookies.get(IMAGE_VIEWER_COOKIE)?.value) ?? randomBytes(32).toString("hex");
    const result = await verifyAlfanum(token, body.alfanum, viewer);
    if (!result) return Response.json({ message: "Validación no disponible." }, { status: 404, headers });
    const response = NextResponse.json(result, { headers });
    if (result.found && result.image) response.cookies.set(IMAGE_VIEWER_COOKIE, viewer, { httpOnly: true, secure: new URL(process.env.NEXTAUTH_URL!).protocol === "https:", sameSite: "strict", path: "/api/public", maxAge: 1800 });
    return response;
  } catch (cause) {
    if (cause instanceof RangeError) return Response.json({ message: "Solicitud demasiado grande." }, { status: 413, headers });
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) return Response.json({ message: "Introduce un alfanumérico válido: solo letras y números." }, { status: 400, headers });
    console.error("PUBLIC_LOOKUP_FAILED");
    return Response.json({ message: "El servicio no está disponible temporalmente. Inténtalo de nuevo." }, { status: 503, headers });
  }
}
