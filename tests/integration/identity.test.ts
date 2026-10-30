import { beforeEach, afterAll, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('/valweb_test')) throw new Error('TEST_DATABASE_URL must point to valweb_test');
  process.env.DATABASE_URL = url;
});
import { createHash, randomUUID } from 'node:crypto';
import { hash } from 'argon2';
import { prisma } from '../../src/lib/prisma';
import { limitRequest } from '../../src/features/identity/rate-limit';
import * as mail from '../../src/features/identity/mail';
import { processOneAccessEmail } from '../../src/features/identity/mail-outbox';
import { authenticate, resolveActor, currentActor, listUsers, listConsultationUsers, createTenant, inviteUser, inviteConsultationUser, saveConsultationUserValidations, setTenantStatus, setUserStatus, revokeUserSessions, consumeAccessToken, getAccessTokenInfo, requestPasswordReset } from '../../src/features/identity/service';

vi.spyOn(mail, 'sendAccessEmail').mockResolvedValue(undefined);
let admin: NonNullable<Awaited<ReturnType<typeof authenticate>>>;
let client: typeof admin;
let otherTenant: string;
const validationIds = { protected: randomUUID(), second: randomUUID(), foreign: randomUUID(), open: randomUUID() };
const validationTokens = { protected: randomUUID(), second: randomUUID(), foreign: randomUUID(), open: randomUUID() };
beforeEach(async () => {
  vi.clearAllMocks();
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
  await prisma.accessEmailOutbox.deleteMany();
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
  await prisma.validation.createMany({ data: [
    { id: validationIds.protected, tenantId: tenant.id, createdById: admin.id, name: 'Protected A', title: 'Protected A', instructions: '', successMessage: 'OK', errorMessage: 'No', publicToken: validationTokens.protected, requireClientAccess: true },
    { id: validationIds.second, tenantId: tenant.id, createdById: admin.id, name: 'Protected B', title: 'Protected B', instructions: '', successMessage: 'OK', errorMessage: 'No', publicToken: validationTokens.second, requireClientAccess: true },
    { id: validationIds.foreign, tenantId: otherTenant, createdById: admin.id, name: 'Foreign', title: 'Foreign', instructions: '', successMessage: 'OK', errorMessage: 'No', publicToken: validationTokens.foreign, requireClientAccess: true },
    { id: validationIds.open, tenantId: tenant.id, createdById: admin.id, name: 'Open', title: 'Open', instructions: '', successMessage: 'OK', errorMessage: 'No', publicToken: validationTokens.open, requireClientAccess: false },
  ] });
});
afterAll(async () => { await prisma.$disconnect(); });
describe('identity against PostgreSQL', () => {
  it('keeps PostgreSQL timestamps aligned with the application clock', async () => {
    const [row] = await prisma.$queryRaw<Array<{ now: Date }>>`SELECT now()`;
    expect(Math.abs(row.now.getTime() - Date.now())).toBeLessThan(5000);
  });
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
  it('invites consultation-only users with a 48-hour token and validation grants', async () => {
    const input = { email: 'consultation@example.test', name: 'Consultation', tenantId: client.tenantId!, validationIds: [validationIds.protected] };
    const invited = await inviteConsultationUser(admin, input);
    const access = await prisma.accessToken.findFirstOrThrow({ where: { userId: invited.id, purpose: 'INVITE', usedAt: null } });
    expect(invited.role).toBe('CONSULTATION_ONLY');
    expect(invited).not.toHaveProperty('passwordHash');
    expect(access.expiresAt.getTime() - Date.now()).toBeGreaterThan(47 * 60 * 60 * 1000);
    expect(access.expiresAt.getTime() - Date.now()).toBeLessThan(48 * 60 * 60 * 1000 + 1000);
    expect(await prisma.userValidationAccess.count({ where: { userId: invited.id, validationId: validationIds.protected } })).toBe(1);

    const resent = await inviteConsultationUser(admin, input);
    expect(resent.id).toBe(invited.id);
    expect(await prisma.accessToken.count({ where: { userId: invited.id, purpose: 'INVITE', usedAt: null } })).toBe(1);
  });
  it('rejects consultation invitations from CLIENT users', async () => {
    await expect(inviteConsultationUser(client!, { email: 'not-admin@example.test', name: 'No admin', tenantId: client!.tenantId!, validationIds: [validationIds.protected] })).rejects.toThrow('No tienes permiso');
    expect(await prisma.user.findUnique({ where: { email: 'not-admin@example.test' } })).toBeNull();
  });
  it('does not authorize consultation-only accounts in panel identity services', async () => {
    const invited = await inviteConsultationUser(admin!, { email: 'panel-denied@example.test', name: 'Panel denied', tenantId: client!.tenantId!, validationIds: [validationIds.protected] });
    const user = await prisma.user.update({ where: { id: invited.id }, data: { status: 'ACTIVE', passwordHash: await hash('Panel-denial-password-2026!') } });
    await expect(prisma.$transaction(tx => currentActor(tx, { id: user.id, tenantId: user.tenantId, role: 'CONSULTATION_ONLY', sessionVersion: user.sessionVersion }))).rejects.toThrow('No tienes permiso para usar el panel.');
  });
  it('rejects grants for another tenant or an unprotected validation', async () => {
    const input = { email: 'bad-grant@example.test', name: 'Bad grant', tenantId: client!.tenantId!, validationIds: [validationIds.foreign] };
    await expect(inviteConsultationUser(admin!, input)).rejects.toThrow();
    await expect(inviteConsultationUser(admin!, { ...input, email: 'no-grants@example.test', validationIds: [] })).rejects.toThrow('Selecciona al menos una validación protegida.');
    await expect(inviteConsultationUser(admin!, { ...input, email: 'open-grant@example.test', validationIds: [validationIds.open] })).rejects.toThrow();
    expect(await prisma.user.findUnique({ where: { email: input.email } })).toBeNull();
    expect(await prisma.user.findUnique({ where: { email: 'open-grant@example.test' } })).toBeNull();
  });
  it('adds and removes validation grants without allowing cross-tenant links', async () => {
    const invited = await inviteConsultationUser(admin!, { email: 'grant-edit@example.test', name: 'Grant edit', tenantId: client!.tenantId!, validationIds: [validationIds.protected] });
    await saveConsultationUserValidations(admin!, invited.id, [validationIds.protected, validationIds.second]);
    expect(await prisma.userValidationAccess.count({ where: { userId: invited.id } })).toBe(2);
    await expect(saveConsultationUserValidations(admin!, invited.id, [validationIds.foreign])).rejects.toThrow();
    await saveConsultationUserValidations(admin!, invited.id, [validationIds.second]);
    expect(await prisma.userValidationAccess.findMany({ where: { userId: invited.id }, select: { validationId: true } })).toEqual([{ validationId: validationIds.second }]);
  });
  it('lists only consultation users and permissions belonging to the CLIENT tenant', async () => {
    const own = await inviteConsultationUser(admin!, { email: 'own-consultation@example.test', name: 'Own consultation', tenantId: client!.tenantId!, validationIds: [validationIds.protected] });
    await inviteConsultationUser(admin!, { email: 'foreign-consultation@example.test', name: 'Foreign consultation', tenantId: otherTenant, validationIds: [validationIds.foreign] });
    const visible = await listConsultationUsers(client!);
    expect(visible.rows.map(row => row.id)).toEqual([own.id]);
    expect(visible.rows[0].queryValidationAccesses.map(access => access.validation.id)).toEqual([validationIds.protected]);
    expect(visible.rows[0]).not.toHaveProperty('passwordHash');
  });
  it('blocks consultation users after their tenant is suspended', async () => {
    const invited = await inviteConsultationUser(admin!, { email: 'suspend-consultation@example.test', name: 'Suspend consultation', tenantId: client!.tenantId!, validationIds: [validationIds.protected] });
    await processOneAccessEmail();
    const token = vi.mocked(mail.sendAccessEmail).mock.calls.at(-1)![1];
    const accessInfo = await getAccessTokenInfo(token);
    expect(accessInfo?.email).toBe('suspend-consultation@example.test');
    await consumeAccessToken(token, 'Consultation-password-2026!');
    const active = await prisma.user.findUniqueOrThrow({ where: { id: invited.id } });
    const sessionVersion = active.sessionVersion;
    await setTenantStatus(admin!, client!.tenantId!, 'SUSPENDED');
    expect(await resolveActor(invited.id, sessionVersion)).toBeNull();
    expect(await getAccessTokenInfo(token)).toBeNull();
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
  it('queues recovery requests without revealing missing or disabled accounts', async () => {
    await expect(requestPasswordReset('absent@example.test')).resolves.toBeUndefined();
    expect(await prisma.accessEmailOutbox.count({ where: { recipient: 'absent@example.test' } })).toBe(1);
    await setUserStatus(admin, client.id, 'DISABLED');
    await expect(requestPasswordReset('client@example.test')).resolves.toBeUndefined();
    expect(await prisma.accessEmailOutbox.count({ where: { recipient: 'client@example.test' } })).toBe(1);
    await processOneAccessEmail();
    await processOneAccessEmail();
    expect(mail.sendAccessEmail).not.toHaveBeenCalled();
    expect(await prisma.accessEmailOutbox.count()).toBe(0);
  });
  it('retries access mail from the durable outbox and supersedes old reset links', async () => {
    await requestPasswordReset('client@example.test');
    await processOneAccessEmail();
    const previousToken = vi.mocked(mail.sendAccessEmail).mock.calls[0][1];
    await requestPasswordReset('client@example.test');
    await processOneAccessEmail();
    const currentToken = vi.mocked(mail.sendAccessEmail).mock.calls[1][1];
    expect(currentToken).not.toBe(previousToken);
    await expect(consumeAccessToken(previousToken, 'Replacement-password-123')).rejects.toThrow();
    expect(await prisma.accessToken.count({ where: { userId: client.id, usedAt: null } })).toBe(1);
    await expect(inviteUser(admin, { email: 'queued@example.test', name: 'Queued', tenantId: otherTenant })).resolves.toBeDefined();
    expect(await prisma.user.findUnique({ where: { email: 'queued@example.test' } })).not.toBeNull();
    expect(await prisma.accessEmailOutbox.count({ where: { recipient: 'queued@example.test', purpose: 'INVITE' } })).toBe(1);
  });
});
