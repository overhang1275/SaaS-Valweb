import { getPublicValidation } from "@/features/public/service";
import { publicValidationManifest } from "@/features/public/manifest";

export async function GET(_request: Request, { params }: { params: Promise<{ publicToken: string }> }) {
  const { publicToken } = await params;
  const validation = await getPublicValidation(publicToken);
  const headers = { "Cache-Control": "no-store" };
  return validation ? Response.json(publicValidationManifest(publicToken, validation.title), { headers: { ...headers, "Content-Type": "application/manifest+json" } }) : Response.json({ message: "Validación no disponible." }, { status: 404, headers });
}
