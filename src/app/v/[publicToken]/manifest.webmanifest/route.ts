import { getPublicValidation } from "@/features/public/service";
import { cookies } from "next/headers";
import { hasPublicValidationAccess, PUBLIC_ACCESS_COOKIE } from "@/features/public/access";
import { publicValidationManifest } from "@/features/public/manifest";

export async function GET(_request: Request, { params }: { params: Promise<{ publicToken: string }> }) {
  const headers = { "Cache-Control": "no-store" };
  const { publicToken } = await params;
  const validation = await getPublicValidation(publicToken);
  if (validation?.requireClientAccess && !await hasPublicValidationAccess(validation.id, (await cookies()).get(PUBLIC_ACCESS_COOKIE)?.value)) return Response.json({ message: "Validación no disponible." }, { status: 404, headers });
  return validation ? Response.json(publicValidationManifest(publicToken, validation.title), { headers: { ...headers, "Content-Type": "application/manifest+json" } }) : Response.json({ message: "Validación no disponible." }, { status: 404, headers });
}
