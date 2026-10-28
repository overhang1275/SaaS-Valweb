import { decode, encode } from "next-auth/jwt";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { authenticate, resolveActor, type Actor } from "@/features/identity/service";

export const PUBLIC_ACCESS_COOKIE = "valweb_public_access";
const available = { status: "ACTIVE" as const, deletedAt: null, tenant: { status: "ACTIVE" as const }, activeDataset: { status: "PUBLISHED" as const } };
const secret = () => {
  if (!process.env.NEXTAUTH_SECRET) throw new Error("Falta configurar el secreto de sesión.");
  return process.env.NEXTAUTH_SECRET;
};

export async function authenticatePublicClient(token: string, email: string, password: string) {
  if (!z.uuid().safeParse(token).success) return null;
  const validation = await prisma.validation.findFirst({ where: { ...available, publicToken: token }, select: { id: true, tenantId: true, requireClientAccess: true } });
  if (!validation?.requireClientAccess) return null;
  const actor = await authenticate(email, password);
  return actor?.role === "CLIENT" && actor.tenantId === validation.tenantId ? createPublicAccessToken(actor, validation.tenantId) : null;
}

export async function createPublicAccessToken(actor: Actor, tenantId: string) {
  return encode({ secret: secret(), maxAge: 8 * 60 * 60, token: { sub: actor.id, sessionVersion: actor.sessionVersion, tenantId } });
}

export async function hasPublicValidationAccess(validationId: string, accessToken?: string) {
  const validation = await prisma.validation.findFirst({ where: { ...available, id: validationId }, select: { id: true, tenantId: true, requireClientAccess: true } });
  if (!validation) return false;
  if (!validation.requireClientAccess) return true;
  if (!accessToken || accessToken.length > 4096) return false;
  try {
    const claims = await decode({ token: accessToken, secret: secret() });
    const parsed = z.object({ sub: z.uuid(), sessionVersion: z.number().int().nonnegative(), tenantId: z.uuid() }).safeParse(claims);
    if (!parsed.success || parsed.data.tenantId !== validation.tenantId) return false;
    const actor = await resolveActor(parsed.data.sub, parsed.data.sessionVersion);
    return actor?.role === "CLIENT" && actor.tenantId === validation.tenantId;
  } catch { return false; }
}

export async function hasPublicAccessForToken(token: string, accessToken?: string) {
  if (!z.uuid().safeParse(token).success) return false;
  const validation = await prisma.validation.findFirst({ where: { ...available, publicToken: token }, select: { id: true } });
  return validation ? hasPublicValidationAccess(validation.id, accessToken) : false;
}

