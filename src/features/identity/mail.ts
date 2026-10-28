import nodemailer from 'nodemailer';

export async function sendAccessEmail(email: string, token: string, purpose: 'INVITE' | 'RESET'): Promise<void> {
  const { SMTP_USER, SMTP_PASSWORD, NEXTAUTH_URL } = process.env;
  const SMTP_HOST = process.env.SMTP_HOST || 'smtp.office365.com';
  const SMTP_PORT = process.env.SMTP_PORT || '587';
  const SMTP_FROM = process.env.SMTP_FROM || SMTP_USER;
  const office365 = SMTP_HOST.toLowerCase() === 'smtp.office365.com';
  if (!SMTP_FROM || !NEXTAUTH_URL || (office365 && (!SMTP_USER || !SMTP_PASSWORD))) throw new Error('El correo SMTP no está configurado.');
  const port = Number(SMTP_PORT);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('El puerto SMTP no es válido.');
  const url = new URL('/establecer-password', NEXTAUTH_URL);
  url.searchParams.set('token', token);
  const transport = nodemailer.createTransport({ host: SMTP_HOST, port, connectionTimeout: 4000, greetingTimeout: 4000, socketTimeout: 8000, disableFileAccess: true, disableUrlAccess: true, secure: port === 465, requireTLS: office365, tls: { minVersion: 'TLSv1.2' }, auth: SMTP_USER ? { user: SMTP_USER, pass: SMTP_PASSWORD } : undefined });
  await transport.sendMail({ from: SMTP_FROM, to: email, subject: purpose === 'INVITE' ? 'Activa tu acceso a Valweb' : 'Recupera tu acceso a Valweb', text: `Establece tu contraseña usando este enlace: ${url.toString()}\nSi no solicitaste este acceso, ignora este mensaje.` });
}
