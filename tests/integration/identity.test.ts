import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('/valweb_test')) throw new Error('TEST_DATABASE_URL must point to valweb_test');
  process.env.DATABASE_URL = url;
});
import { createHash } from 'node:crypto';
import { hash } from 'argon2';
import { prisma } from '../../src/lib/prisma';
import { limitRequest } from '../../src/features/identity/rate-limit';
import * as mail from '../../src/features/identity/mail';
import { authenticate, resolveActor, listUsers, createTenant, inviteUser, setTenantStatus, setUserStatus, revokeUserSessions, consumeAccessToken, requestPasswordReset } from '../../src/features/identity/service';

vi.spyOn(mail, 'sendAccessEmail').mockResolvedValue(undefined);
let admin: NonNullable<Awaited<ReturnType<typeof authenticate>>>;
let client: typeof admin;
let otherTenant: string;
beforeEach(async () => {
  await prisma.validationDailyStat.deleteMany();
  await prisma.importImageItem.deleteMany();
  await prisma.importJob.deleteMany();
  await prisma.recordImage.deleteMany();
  await prisma.validation.updateMany({ data: { activeDatasetId: null } });
  await prisma.folio.deleteMany();
  await prisma.dataset.deleteMany();
  await prisma.validation.deleteMany();
  await prisma.rateLimitBucket.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.accessToken.deleteMany();
  await prisma.user.deleteMany();
  await prisma.tenant.deleteMany();
  const passwordHash = await hash('Correct-password-123');
  const owner = await prisma.user.create({ data: { email: 'admin@example.test', name: 'Admin', role: 'ADMIN', status: 'ACTIVE', passwordHash } });
  admin = { id: owner.id, role: 'ADMIN', tenantId: null, sessionVersion: 0 };
  const tenant = await createTenant(admin, { name: 'First account' });
  otherTenant = (await createTenant(admin, { name: 'Second account' })).id;
  const user = await prisma.user.create({ data: { email: 'client@example.test', name: 'Client', role: 'CLIENT', status: 'ACTIVE', tenantId: tenant.id, passwordHash } });
  client = { id: user.id, role: 'CLIENT', tenantId: tenant.id, sessionVersion: 0 };
  await prisma.user.create({ data: { email: 'other@example.test', name: 'Other', role: 'CLIENT', status: 'ACTIVE', tenantId: otherTenant, passwordHash } });
});
afterAll(async () => { await prisma.$disconnect(); });
describe('identity against PostgreSQL', () => {
  it('enforces a rate limit atomically under concurrency', async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => limitRequest('test', 'same-key', 3, 60)));
    expect(results.filter(Boolean)).toHaveLength(3);
    expect(await limitRequest('test', 'other-key', 3, 60)).toBe(true);
  });
  it('enforces role and tenant constraints in PostgreSQL', async () => {
    await expect(prisma.user.create({ data: { email: 'bad-admin@example.test', name: 'Bad', role: 'ADMIN', tenantId: otherTenant } })).rejects.toThrow();
    await expect(prisma.user.create({ data: { email: 'bad-client@example.test', name: 'Bad', role: 'CLIENT' } })).rejects.toThrow();
  });
  it('resends invitations only in the same tenant and invalidates old tokens', async () => {
    const input = { email: 'invited@example.test', name: 'Invited', tenantId: otherTenant };
    const first = await inviteUser(admin, input);
    const second = await inviteUser(admin, input);
    expect(second.id).toBe(first.id);
    expect(await prisma.accessToken.count({ where: { userId: first.id, usedAt: null } })).toBe(1);
    await expect(inviteUser(admin, { ...input, tenantId: client.tenantId! })).rejects.toThrow();
  });
  it('isolates tenants and rejects forged admin roles', async () => {
    const { rows: users } = await listUsers(client);
    expect(users.map(u => u.email)).toEqual(['client@example.test']);
    expect(users[0]).not.toHaveProperty('passwordHash');
    await expect(createTenant({ ...client, role: 'ADMIN' }, { name: 'Escalated' })).rejects.toThrow();
    await expect(inviteUser(client, { email: 'new@example.test', name: 'New', tenantId: otherTenant })).rejects.toThrow();
  });
  it('revokes old sessions permanently on disabling and suspension', async () => {
    await setUserStatus(admin, client.id, 'DISABLED');
    await setUserStatus(admin, client.id, 'ACTIVE');
    expect(await resolveActor(client.id, 0)).toBeNull();
    await expect(listUsers(client)).rejects.toThrow();
    const current = await authenticate('client@example.test', 'Correct-password-123');
    expect(current).not.toBeNull();
    await setTenantStatus(admin, client.tenantId!, 'SUSPENDED');
    expect(await authenticate('client@example.test', 'Correct-password-123')).toBeNull();
    await setTenantStatus(admin, client.tenantId!, 'ACTIVE');
    expect(await resolveActor(client.id, current!.sessionVersion)).toBeNull();
  });
  it('revokes JWT versions and prevents self disable', async () => {
    await revokeUserSessions(admin, client.id);
    expect(await resolveActor(client.id, 0)).toBeNull();
    await expect(setUserStatus(admin, admin.id, 'DISABLED')).rejects.toThrow();
  });
  it('rejects expired tokens and atomically consumes a token once', async () => {
    const token = 'a'.repeat(64);
    const record = await prisma.accessToken.create({ data: { userId: client.id, tokenHash: createHash('sha256').update(token).digest('hex'), purpose: 'RESET', expiresAt: new Date(Date.now() - 1000) } });
    await expect(consumeAccessToken(token, 'Replacement-password-123')).rejects.toThrow();
    await prisma.accessToken.update({ where: { id: record.id }, data: { expiresAt: new Date(Date.now() + 60000) } });
    const result = await Promise.allSettled([consumeAccessToken(token, 'Replacement-password-123'), consumeAccessToken(token, 'Replacement-password-456')]);
    expect(result.filter(x => x.status === 'fulfilled')).toHaveLength(1);
    expect(await resolveActor(client.id, 0)).toBeNull();
  });
  it('does not enumerate missing or disabled recovery accounts', async () => {
    await expect(requestPasswordReset('absent@example.test')).resolves.toBeUndefined();
    await setUserStatus(admin, client.id, 'DISABLED');
    await expect(requestPasswordReset('client@example.test')).resolves.toBeUndefined();
  });
  it('invalidates previous reset tokens and rolls invitation back on mail failure', async () => {
    await requestPasswordReset('client@example.test');
    await requestPasswordReset('client@example.test');
    expect(await prisma.accessToken.count({ where: { userId: client.id, usedAt: null } })).toBe(1);
    vi.mocked(mail.sendAccessEmail).mockRejectedValueOnce(new Error('SMTP unavailable'));
    await expect(inviteUser(admin, { email: 'failed@example.test', name: 'Failed', tenantId: otherTenant })).rejects.toThrow();
    expect(await prisma.user.findUnique({ where: { email: 'failed@example.test' } })).toBeNull();
  });
});
