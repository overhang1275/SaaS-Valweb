import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import nodemailer from 'nodemailer';
import { sendAccessEmail, sendConfiguredTestEmail } from './mail';
import { encryptSecret } from '../../lib/secrets';
const settings = vi.hoisted(() => ({ read: vi.fn() }));
vi.mock('../../lib/prisma', () => ({ prisma: { smtpSettings: { findUnique: settings.read } } }));
vi.mock('nodemailer', () => ({ default: { createTransport: vi.fn(() => ({ sendMail: vi.fn().mockResolvedValue({}) })) } }));
beforeEach(() => { settings.read.mockResolvedValue(null); });
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
it('uses saved configuration for both queued access emails and the configured test message', async () => {
  vi.stubEnv('NEXTAUTH_SECRET', 'test-mail-settings-encryption-key');
  vi.stubEnv('NEXTAUTH_URL', 'https://example.test');
  vi.stubEnv('SMTP_HOST', 'environment.example.test');
  vi.stubEnv('SMTP_USER', 'environment@example.test');
  vi.stubEnv('SMTP_PASSWORD', 'environment-password');
  settings.read.mockResolvedValue({ id: 1, host: 'saved.example.test', port: 465, from: 'Valweb <saved@example.test>', user: 'saved@example.test', encryptedPassword: encryptSecret('saved-password', 'smtp-settings') });
  await sendAccessEmail('recipient@example.test', 'a'.repeat(64), 'INVITE');
  expect(await sendConfiguredTestEmail()).toBe('saved@example.test');
  expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: 'saved.example.test', port: 465, secure: true, auth: { user: 'saved@example.test', pass: 'saved-password' } }));
});
it('requires STARTTLS when authenticating to a custom SMTP server', async () => {
  vi.stubEnv('NEXTAUTH_URL', 'https://example.test');
  vi.stubEnv('SMTP_HOST', 'custom.example.test'); vi.stubEnv('SMTP_PORT', '587');
  vi.stubEnv('SMTP_USER', 'mailer@example.test'); vi.stubEnv('SMTP_PASSWORD', 'password');
  await sendAccessEmail('recipient@example.test', 'a'.repeat(64), 'RESET');
  expect(nodemailer.createTransport).toHaveBeenCalledWith(expect.objectContaining({ secure: false, requireTLS: true }));
});
it('sends the test to the sender address when the SMTP login is not an email address', async () => {
  vi.stubEnv('NEXTAUTH_SECRET', 'test-mail-settings-encryption-key');
  vi.stubEnv('NEXTAUTH_URL', 'https://example.test');
  settings.read.mockResolvedValue({ id: 1, host: 'saved.example.test', port: 587, from: 'Valweb <sender@example.test>', user: 'smtp-login', encryptedPassword: encryptSecret('saved-password', 'smtp-settings') });
  expect(await sendConfiguredTestEmail()).toBe('sender@example.test');
});
