import { z } from "zod";
import type { NextRequest } from "next/server";
import { publicImage } from "@/features/public/service";
import { IMAGE_VIEWER_COOKIE, imageViewerHash, validViewerSecret } from "@/features/public/viewer-session";
import { readBoundedJson } from "@/lib/request-json";
import { limitRequest } from "@/features/identity/rate-limit";

export const runtime = "nodejs";
const headers = { "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff", "Cross-Origin-Resource-Policy": "same-origin" };
export async function POST(request: NextRequest) {
  try {
    if (request.headers.get("origin") !== new URL(process.env.NEXTAUTH_URL!).origin) return Response.json({ message: "Origen no permitido." }, { status: 403, headers });
    const viewer = validViewerSecret(request.cookies.get(IMAGE_VIEWER_COOKIE)?.value);
    if (!viewer) return Response.json({ message: "Imagen no disponible. Vuelve a consultar el código." }, { status: 404, headers });
    if (!await limitRequest("public-image-global", "all", 300, 60) || !await limitRequest("public-image-viewer", imageViewerHash(viewer), 60, 60)) return Response.json({ message: "Demasiadas solicitudes de imagen. Espera un minuto." }, { status: 429, headers: { ...headers, "Retry-After": "60" } });
    const { grant } = z.object({ grant: z.string().min(1).max(2048) }).parse(await readBoundedJson(request, 4096));
    const data = await publicImage(grant, viewer);
    return data ? new Response(new Uint8Array(data), { headers: { ...headers, "Content-Type": "image/webp" } }) : Response.json({ message: "La autorización de imagen caducó o ya no está disponible. Vuelve a consultar el código." }, { status: 404, headers });
  } catch (cause) {
    if (cause instanceof RangeError) return Response.json({ message: "Solicitud demasiado grande." }, { status: 413, headers });
    if (cause instanceof z.ZodError || cause instanceof SyntaxError) return Response.json({ message: "Autorización de imagen no válida." }, { status: 400, headers });
    console.error("PUBLIC_IMAGE_FAILED");
    return Response.json({ message: "No se pudo entregar la imagen. Inténtalo de nuevo." }, { status: 503, headers });
  }
}
