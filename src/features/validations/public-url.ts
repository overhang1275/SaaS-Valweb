export function publicValidationUrl(token: string) {
  const origin = process.env.NEXTAUTH_URL;
  if (!origin) throw new Error("NEXTAUTH_URL no está configurado.");
  return new URL(`/v/${token}`, origin).toString();
}
