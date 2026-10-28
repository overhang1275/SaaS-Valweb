import { afterEach, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { sendAccessEmail } from './mail';
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })) } }));
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('defaults to Office365 STARTTLS with configured credentials', async () => {
  vi.stubEnv('SMTP_HOST', ''); vi.stubEnv('SMTP_PORT', ''); vi.stubEnv('SMTP_FROM', '');
  vi.stubEnv('SMTP_USER', 'configured@example.test'); vi.stubEnv('SMTP_PASSWORD', 'test-only');
  vi.stubEnv('NEXTAUTH_URL', 'https://example.test');
  await sendAccessEmail('recipient@example.test', 'a'.repeat(64), 'INVITE');
  expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'smtp.office365.com', port: 587, secure: false, requireTLS: true, tls: { minVersion: 'TLSv1.2' }, auth: { user: 'configured@example.test', pass: 'test-only' } }));
});
it('does not create transport without Office365 credentials', async () => {
  vi.stubEnv('SMTP_HOST', ''); vi.stubEnv('SMTP_USER', ''); vi.stubEnv('SMTP_PASSWORD', '');
  await expect(sendAccessEmail('recipient@example.test', 'a'.repeat(64), 'RESET')).rejects.toThrow('SMTP');
  expect(nodemailer.createTransport).not.toHaveBeenCalled();
});
