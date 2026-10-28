import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import nodemailer from 'nodemailer';

const htmlEscapes: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, char => htmlEscapes[char]);
function emailTokenKey() {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) throw new Error('NEXTAUTH_SECRET no está configurado.');
  return createHash('sha256').update(`valweb-access-email:${secret}`).digest();
}

export function encryptAccessToken(token: string, accessTokenId: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', emailTokenKey(), iv);
  cipher.setAAD(Buffer.from(accessTokenId));
  const encrypted = Buffer.concat([cipher.update(token, 'utf8'), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), encrypted]).toString('base64');
}

export function decryptAccessToken(encryptedToken: string, accessTokenId: string): string {
  const value = Buffer.from(encryptedToken, 'base64');
  if (value.length < 29) throw new Error('El token de correo cifrado no es válido.');
  const decipher = createDecipheriv('aes-256-gcm', emailTokenKey(), value.subarray(0, 12));
  decipher.setAAD(Buffer.from(accessTokenId));
  decipher.setAuthTag(value.subarray(12, 28));
  return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]).toString('utf8');
}

function smtpConfig() {
  const { SMTP_USER, SMTP_PASSWORD, NEXTAUTH_URL } = process.env;
  const host = process.env.SMTP_HOST || 'smtp.office365.com';
  const port = Number(process.env.SMTP_PORT || '587');
  const from = process.env.SMTP_FROM || SMTP_USER;
  const office365 = host.toLowerCase() === 'smtp.office365.com';
  if (!from || !NEXTAUTH_URL || (office365 && (!SMTP_USER || !SMTP_PASSWORD))) throw new Error('El correo SMTP no está configurado.');
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('El puerto SMTP no es válido.');
  return { host, port, from, user: SMTP_USER, password: SMTP_PASSWORD, baseUrl: NEXTAUTH_URL, office365 };
}

function createSmtpTransport(config: ReturnType<typeof smtpConfig>) {
  return nodemailer.createTransport({ host: config.host, port: config.port, connectionTimeout: 4000, greetingTimeout: 4000, socketTimeout: 8000, disableFileAccess: true, disableUrlAccess: true, secure: config.port === 465, requireTLS: config.office365, tls: { minVersion: 'TLSv1.2' }, auth: config.user ? { user: config.user, pass: config.password } : undefined });
}

export async function sendAccessEmail(email: string, token: string, purpose: 'INVITE' | 'RESET'): Promise<void> {
  const config = smtpConfig();
  const url = new URL('/establecer-password', config.baseUrl);
  url.searchParams.set('token', token);
  const invite = purpose === 'INVITE';
  const title = invite ? 'Activa tu acceso' : 'Restablece tu contraseña';
  const intro = invite
    ? 'Te invitaron a unirte a Valweb. Crea una contraseña para acceder a tu espacio.'
    : 'Recibimos una solicitud para cambiar la contraseña de tu cuenta de Valweb.';
  const action = invite ? 'Crear contraseña' : 'Restablecer contraseña';
  const expiry = invite ? 'Este enlace vence en 48 horas.' : 'Este enlace vence en 1 hora.';
  const link = escapeHtml(url.toString());
  const text = `${intro}\n\n${action}: ${url.toString()}\n${expiry}\n\nSi no solicitaste este acceso, ignora este mensaje.`;
  const html = `<!doctype html>
<html lang="es">
  <head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
  <body style="margin:0;padding:0;background:#f5f7fa;color:#002a45;font-family:Arial,Helvetica,sans-serif;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;">${intro}</div>
    <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="background:#f5f7fa;">
      <tr><td align="center" style="padding:36px 16px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;">
          <tr><td style="padding:0 8px 20px;">
            <table role="presentation" cellspacing="0" cellpadding="0" border="0"><tr>
              <td align="center" valign="middle" width="36" height="36" style="width:36px;height:36px;border-radius:9px;background:#e5213c;color:#fff;font-size:22px;font-weight:bold;">✓</td>
              <td style="padding-left:10px;color:#002a45;font-size:21px;font-weight:bold;line-height:1.1;">Valweb<br><span style="color:#5e6e80;font-size:11px;font-weight:normal;">by Computer Forms</span></td>
            </tr></table>
          </td></tr>
          <tr><td style="padding:36px 32px;background:#fff;border:1px solid #e2e8ef;border-radius:12px;">
            <h1 style="margin:0 0 14px;color:#002a45;font-size:25px;line-height:1.25;">${title}</h1>
            <p style="margin:0 0 26px;color:#5e6e80;font-size:15px;line-height:1.7;">${intro}</p>
            <p style="margin:0 0 26px;">
              <a href="${link}" style="display:inline-block;padding:12px 20px;border:1px solid #002a45;border-radius:8px;background:#002a45;color:#fff;font-size:14px;font-weight:bold;line-height:1.4;text-decoration:none;">${action}</a>
            </p>
            <p style="margin:0 0 10px;color:#5e6e80;font-size:13px;line-height:1.6;">${expiry}</p>
            <p style="margin:0;color:#5e6e80;font-size:13px;line-height:1.6;">Si el botón no funciona, copia este enlace en tu navegador:</p>
            <p style="margin:8px 0 0;overflow-wrap:anywhere;font-size:12px;line-height:1.6;"><a href="${link}" style="color:#aa1b30;">${link}</a></p>
          </td></tr>
          <tr><td style="padding:20px 8px 0;color:#5e6e80;font-size:12px;line-height:1.6;">
            Si no solicitaste este acceso, puedes ignorar este correo.<br>Valweb · Computer Forms
          </td></tr>
        </table>
      </td></tr>
    </table>
  </body>
</html>`;
  await createSmtpTransport(config).sendMail({ from: config.from, to: email, subject: invite ? 'Activa tu acceso a Valweb' : 'Recupera tu acceso a Valweb', text, html });
}

export async function sendConfiguredTestEmail(): Promise<string> {
  const config = smtpConfig();
  const recipient = config.user || config.from;
  const text = 'Este mensaje confirma que el correo de Valweb está configurado y pudo enviar desde Ajustes generales.';
  const html = `<!doctype html><html lang="es"><body style="margin:0;padding:36px 16px;background:#f5f7fa;color:#002a45;font-family:Arial,Helvetica,sans-serif;"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0" style="max-width:560px;"><tr><td style="padding:0 8px 20px;color:#002a45;font-size:21px;font-weight:bold;">Valweb <span style="color:#5e6e80;font-size:11px;font-weight:normal;">by Computer Forms</span></td></tr><tr><td style="padding:32px;background:#fff;border:1px solid #e2e8ef;border-radius:12px;"><h1 style="margin:0 0 14px;font-size:24px;">Prueba de correo</h1><p style="margin:0;color:#5e6e80;font-size:15px;line-height:1.7;">${text}</p></td></tr><tr><td style="padding:18px 8px 0;color:#5e6e80;font-size:12px;">Valweb · Computer Forms</td></tr></table></td></tr></table></body></html>`;
  await createSmtpTransport(config).sendMail({ from: config.from, to: recipient, subject: 'Prueba de correo de Valweb', text, html });
  return recipient;
}
