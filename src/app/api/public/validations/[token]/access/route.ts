import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { authenticatePublicClient, PUBLIC_ACCESS_COOKIE } from "@/features/public/access";
import { limitRequest } from "@/features/identity/rate-limit";
import { readBoundedJson } from "@/lib/request-json";

export const runtime = "nodejs";
export async function POST(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" };
  try {
    if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL!).origin) return Response.json({ message: "Origen no permitido." }, { status: 403, headers });
    const { token } = await params;
    const ip = process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for")?.split(",").at(-1)?.trim() || "shared" : "shared";
    if (!await limitRequest("public-access", `${token}:${ip}`, 5, 900)) return Response.json({ message: "Demasiados intentos. Espera 15 minutos." }, { status: 429, headers: { ...headers, "Retry-After": "900" } });
    const body = z.object({ email: z.email().max(254), password: z.string().min(1).max(128) }).parse(await readBoundedJson(request, 2048));
    if (!await limitRequest("public-access-email", body.email.trim().toLowerCase(), 5, 900)) return Response.json({ message: "Demasiados intentos. Espera 15 minutos." }, { status: 429, headers: { ...headers, "Retry-After": "900" } });
    const accessToken = await authenticatePublicClient(token, body.email, body.password);
    if (!accessToken) return Response.json({ message: "El correo o la contraseña no son válidos para esta consulta." }, { status: 401, headers });
    const response = NextResponse.json({ ok: true }, { headers });
    response.cookies.set(PUBLIC_ACCESS_COOKIE, accessToken, { httpOnly: true, secure: new URL(process.env.NEXTAUTH_URL!).protocol === "https:", sameSite: "strict", path: "/", maxAge: 8 * 60 * 60 });
    return response;
  } catch (cause) {
    if (cause instanceof RangeError) return Response.json({ message: "Solicitud demasiado grande." }, { status: 413, headers });
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) return Response.json({ message: "Introduce un correo y contraseña válidos." }, { status: 400, headers });
    console.error("PUBLIC_ACCESS_FAILED");
    return Response.json({ message: "No se pudo iniciar sesión. Inténtalo de nuevo." }, { status: 503, headers });
  }
}
