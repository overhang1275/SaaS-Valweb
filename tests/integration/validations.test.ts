import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => {
  const url = process.env.TEST_DATABASE_URL;
  if (!url || !new URL(url).pathname.endsWith('/valweb_test')) throw new Error('TEST_DATABASE_URL must point to valweb_test');
  process.env.DATABASE_URL = url;
});
import { randomUUID } from 'node:crypto';
import { prisma } from '../../src/lib/prisma';
import type { Actor } from '../../src/features/identity/service';
import { listValidations, getValidation, createValidation, updateValidation, deleteValidation } from '../../src/features/validations/service';
const ids = { admin: randomUUID(), client: randomUUID(), other: randomUUID(), first: randomUUID(), second: randomUUID() };
const admin: Actor = { id: ids.admin, role: 'ADMIN', tenantId: null, sessionVersion: 0 };
const client: Actor = { id: ids.client, role: 'CLIENT', tenantId: ids.first, sessionVersion: 0 };
const other: Actor = { id: ids.other, role: 'CLIENT', tenantId: ids.second, sessionVersion: 0 };
const text = { name: ' Certificate ', title: 'Public title', instructions: '<script>alert(1)</script>', successMessage: 'Valid', errorMessage: 'Invalid' };
beforeAll(async () => {
  await prisma.tenant.createMany({ data: [{ id: ids.first, name: 'Validation test first' }, { id: ids.second, name: 'Validation test second' }] });
  await prisma.user.createMany({ data: [
    { id: ids.admin, email: `${ids.admin}@example.test`, name: 'Admin', role: 'ADMIN', status: 'ACTIVE', passwordHash: 'unused-test-hash' },
    { id: ids.client, email: `${ids.client}@example.test`, name: 'First', role: 'CLIENT', status: 'ACTIVE', tenantId: ids.first, passwordHash: 'unused-test-hash' },
    { id: ids.other, email: `${ids.other}@example.test`, name: 'Second', role: 'CLIENT', status: 'ACTIVE', tenantId: ids.second, passwordHash: 'unused-test-hash' },
  ] });
});
afterAll(async () => {
  await prisma.auditLog.deleteMany({ where: { actorId: { in: [ids.admin, ids.client, ids.other] } } });
  await prisma.validation.deleteMany({ where: { tenantId: { in: [ids.first, ids.second] } } });
  await prisma.user.deleteMany({ where: { id: { in: [ids.admin, ids.client, ids.other] } } });
  await prisma.tenant.deleteMany({ where: { id: { in: [ids.first, ids.second] } } });
  await prisma.$disconnect();
});
describe('validation persistence and authorization', () => {
  it('persists plain text, unique stable tokens, updates and audit', async () => {
    const row = await createValidation(client, text);
    const second = await createValidation(admin, { ...text, tenantId: ids.second });
    expect(row.name).toBe('Certificate');
    expect(row.instructions).toBe(text.instructions);
    expect(row.publicToken).toMatch(/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/);
    expect(row.publicToken).not.toBe(row.id);
    expect(second.publicToken).not.toBe(row.publicToken);
    expect(row.status).toBe('DRAFT');
    const updated = await updateValidation(client, row.id, { ...text, title: 'Updated' });
    expect(updated.publicToken).toBe(row.publicToken);
    expect(updated.title).toBe('Updated');
    expect((await getValidation(admin, row.id))?.tenant.name).toBe('Validation test first');
    const logs = await prisma.auditLog.findMany({ where: { targetId: row.id }, orderBy: { createdAt: 'asc' } });
    expect(logs.map(x => x.action)).toEqual(['VALIDATION_CREATED', 'VALIDATION_UPDATED']);
    expect(logs.every(x => x.actorId === client.id && x.tenantId === ids.first)).toBe(true);
  });
  it('isolates tenants, ignores forged role and account, rejects foreign ownership', async () => {
    const row = await createValidation(other, text);
    const forged: Actor = { ...client, role: 'ADMIN', tenantId: ids.second };
    expect(await getValidation(forged, row.id)).toBeNull();
    expect((await listValidations(forged)).every(x => x.tenantId === ids.first)).toBe(true);
    await expect(updateValidation(forged, row.id, text)).rejects.toThrow('La validación no está disponible.');
    await expect(deleteValidation(forged, row.id)).rejects.toThrow('La validación no está disponible.');
    await expect(createValidation(forged, { ...text, tenantId: ids.second })).rejects.toThrow();
    await expect(createValidation(admin, text)).rejects.toThrow();
  });
  it('validates ids and all text limits', async () => {
    for (const field of ['name', 'title', 'successMessage', 'errorMessage'] as const) await expect(createValidation(client, { ...text, [field]: '  ' })).rejects.toThrow();
    for (const [field, max] of [['name', 120], ['title', 160], ['instructions', 2000], ['successMessage', 500], ['errorMessage', 500]] as const) await expect(createValidation(client, { ...text, [field]: 'x'.repeat(max + 1) })).rejects.toThrow();
    await expect(getValidation(client, 'not-an-id')).rejects.toThrow();
    await expect(updateValidation(client, 'not-an-id', text)).rejects.toThrow();
    await expect(deleteValidation(client, 'not-an-id')).rejects.toThrow();
  });
  it('soft deletes without reusing token or allowing reads and mutations', async () => {
    const row = await createValidation(client, text);
    await deleteValidation(client, row.id);
    expect(await getValidation(client, row.id)).toBeNull();
    expect((await listValidations(client)).some(x => x.id === row.id)).toBe(false);
    await expect(updateValidation(client, row.id, text)).rejects.toThrow('La validación no está disponible.');
    await expect(deleteValidation(client, row.id)).rejects.toThrow('La validación no está disponible.');
    const retained = await prisma.validation.findUniqueOrThrow({ where: { id: row.id } });
    expect(retained.publicToken).toBe(row.publicToken);
    expect(retained.status).toBe('DELETED');
    expect(retained.deletedAt).not.toBeNull();
    expect(await prisma.auditLog.count({ where: { targetId: row.id, action: 'VALIDATION_DELETED', tenantId: ids.first } })).toBe(1);
  });
  it('revalidates revoked sessions and suspended accounts for reads and writes', async () => {
    const row = await createValidation(client, text);
    await prisma.user.update({ where: { id: client.id }, data: { sessionVersion: 1 } });
    await expect(listValidations(client)).rejects.toThrow();
    await expect(createValidation(client, text)).rejects.toThrow();
    const current = { ...client, sessionVersion: 1 };
    await prisma.tenant.update({ where: { id: ids.first }, data: { status: 'SUSPENDED' } });
    await expect(getValidation(current, row.id)).rejects.toThrow();
    await expect(updateValidation(current, row.id, text)).rejects.toThrow();
    await expect(deleteValidation(current, row.id)).rejects.toThrow();
    await expect(createValidation(admin, { ...text, tenantId: ids.first })).rejects.toThrow();
  });
});
