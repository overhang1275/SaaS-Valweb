import { isIP } from "node:net";
import addressparser from "nodemailer/lib/addressparser";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { decryptSecret, encryptSecret } from "@/lib/secrets";
import { currentActor, type Actor } from "@/features/identity/service";

const context = "smtp-settings";
const noControls = (value: string) => !/[\p{Cc}\p{Cf}]/u.test(value);
const schema = z.object({
  host: z.string().trim().toLowerCase().max(253).refine(value => isIP(value) !== 0 || z.hostname().safeParse(value).success, "Indica el nombre o IP del servidor SMTP, sin protocolo ni ruta."),
  port: z.coerce.number().int().min(1).max(65535),
  from: z.string().trim().max(320).refine(value => {
    if (!noControls(value)) return false;
    const addresses = addressparser(value);
    return addresses.length === 1 && "address" in addresses[0] && z.email().safeParse(addresses[0].address).success;
  }, "Indica un único correo remitente válido, por ejemplo Valweb <correo@dominio.com>."),
  user: z.string().trim().max(254).refine(noControls, "El usuario SMTP contiene caracteres no válidos."),
  password: z.string().max(4096, "La contraseña SMTP es demasiado larga.").default(""),
});

export class MailSettingsError extends Error {}

function environmentSettings() {
  return {
    host: process.env.SMTP_HOST || "smtp.office365.com", port: Number(process.env.SMTP_PORT || "587"),
    from: process.env.SMTP_FROM || process.env.SMTP_USER || "", user: process.env.SMTP_USER || "", password: process.env.SMTP_PASSWORD || "",
  };
}

export async function getMailSettings(actor: Actor) {
  return prisma.$transaction(async tx => {
    await currentActor(tx, actor, true);
    const saved = await tx.smtpSettings.findUnique({ where: { id: 1 } });
    const fields = saved || environmentSettings();
    return { host: fields.host, port: Number.isInteger(fields.port) ? fields.port : 587, from: fields.from, user: fields.user,
      hasPassword: Boolean(saved ? saved.encryptedPassword : environmentSettings().password) };
  });
}

export async function saveMailSettings(actor: Actor, input: unknown) {
  await prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor, true);
    const data = schema.parse(input);
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('valweb-smtp-settings', 0))`;
    const saved = await tx.smtpSettings.findUnique({ where: { id: 1 } });
    const fallback = environmentSettings();
    const previous = saved || fallback;
    let encryptedPassword: string | null = null;
    if (data.user) {
      if (data.password) encryptedPassword = encryptSecret(data.password, context);
      else if (data.host === previous.host.toLowerCase() && data.user === previous.user) {
        encryptedPassword = saved ? saved.encryptedPassword : fallback.password ? encryptSecret(fallback.password, context) : null;
      }
      if (!encryptedPassword) throw new MailSettingsError("Introduce la contraseña SMTP. Es necesaria al cambiar el servidor o el usuario.");
    } else if (data.password) throw new MailSettingsError("Indica el usuario SMTP para guardar una contraseña.");
    if (data.host === "smtp.office365.com" && !data.user) throw new MailSettingsError("Microsoft 365 requiere usuario y contraseña SMTP.");
    const fields = { host: data.host, port: data.port, from: data.from, user: data.user, encryptedPassword };
    await tx.smtpSettings.upsert({ where: { id: 1 }, create: { id: 1, ...fields }, update: fields });
    await tx.auditLog.create({ data: { actorId: user.id, action: "SMTP_SETTINGS_UPDATED" } });
  });
}

export async function getSmtpConfig() {
  const saved = await prisma.smtpSettings.findUnique({ where: { id: 1 } });
  const config = saved
    ? { host: saved.host, port: saved.port, from: saved.from, user: saved.user, password: saved.encryptedPassword ? decryptSecret(saved.encryptedPassword, context) : "" }
    : environmentSettings();
  if (!config.from || (config.host.toLowerCase() === "smtp.office365.com" && (!config.user || !config.password))) throw new MailSettingsError("El correo SMTP no está configurado.");
  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) throw new MailSettingsError("El puerto SMTP no es válido.");
  return config;
}
