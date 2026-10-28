import { randomBytes } from 'node:crypto';
import { hash, verify, argon2id } from 'argon2';
import { z } from 'zod';
import { prisma } from '../../lib/prisma';
import type { Prisma } from '../../generated/prisma/client';
import { encryptAccessToken } from './mail';
import { hashAccessToken } from './tokens';
import { tenantListQuerySchema, userListQuerySchema, type TenantListQuery, type UserListQuery } from './list-query';

export type Actor = { id: string; tenantId: string | null; role: 'ADMIN' | 'CLIENT'; sessionVersion: number };
type Tx = Prisma.TransactionClient;
const DUMMY_HASH = '$argon2id$v=19$m=65536,t=3,p=4$2zJKYDxoh1hH0C6GaF9WBw$NPL82B60oB/RHkNjkKmdnmb+rYrfq9uOv5zVhQgnif8';
const emailSchema = z.email().max(254).transform(value => value.trim().toLowerCase());
const nameSchema = z.string().trim().min(1).max(120);
const passwordSchema = z.string().min(12, 'Usa al menos 12 caracteres.').max(128);
const safeUser = { id: true, email: true, name: true, role: true, status: true, tenantId: true, createdAt: true } as const;
const actorOf = (user: Actor): Actor => ({ id: user.id, tenantId: user.tenantId, role: user.role, sessionVersion: user.sessionVersion });
const audit = (tx: Tx, action: string, actorId: string | null, targetId: string) => tx.auditLog.create({ data: { action, actorId, targetId } });

export async function currentActor(tx: Tx, actor: Actor, admin = false) {
  await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${actor.id}::uuid FOR UPDATE`;
  const user = await tx.user.findUnique({ where: { id: actor.id }, include: { tenant: true } });
  if (!user || user.status !== 'ACTIVE' || user.sessionVersion !== actor.sessionVersion || (user.role === 'CLIENT' && user.tenant?.status !== 'ACTIVE')) throw new Error('La sesión ya no es válida.');
  if (admin && user.role !== 'ADMIN') throw new Error('No tienes permiso para esta acción.');
  return user;
}

export async function resolveActor(id: string, sessionVersion: number): Promise<Actor | null> {
  const user = await prisma.user.findUnique({ where: { id }, include: { tenant: true } });
  if (!user || user.status !== 'ACTIVE' || user.sessionVersion !== sessionVersion || (user.role === 'CLIENT' && user.tenant?.status !== 'ACTIVE')) return null;
  return actorOf(user);
}

export async function authenticate(email: string, password: string): Promise<Actor | null> {
  const parsed = emailSchema.safeParse(email.trim());
  if (!parsed.success || password.length > 128) return null;
  const user = await prisma.user.findUnique({ where: { email: parsed.data } });
  const valid = await verify(user?.passwordHash ?? DUMMY_HASH, password);
  if (!user?.passwordHash || !valid) return null;
  const actor = await resolveActor(user.id, user.sessionVersion);
  if (actor) await prisma.auditLog.create({ data: { actorId: user.id, action: 'LOGIN', targetId: user.id } });
  return actor;
}

export async function listTenants(actor: Actor) {
  return prisma.$transaction(async tx => {
    await currentActor(tx, actor, true);
    return tx.tenant.findMany({ include: { _count: { select: { users: true } } }, orderBy: { createdAt: 'desc' } });
  });
}
export async function listTenantPage(actor: Actor, options: TenantListQuery) {
  const query = tenantListQuerySchema.parse(options);
  return prisma.$transaction(async tx => {
    await currentActor(tx, actor, true);
    const where: Prisma.TenantWhereInput = { ...(query.q ? { name: { contains: query.q, mode: 'insensitive' } } : {}), ...(query.estado ? { status: query.estado } : {}) };
    const total = await tx.tenant.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.tenant.findMany({ where, include: { _count: { select: { users: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * query.pageSize, take: query.pageSize });
    return { rows, total, page, pageSize: query.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}
export async function listActiveTenantChoices(actor: Actor) {
  return prisma.$transaction(async tx => {
    await currentActor(tx, actor, true);
    // shortcut: el selector nativo carga los nombres activos; usar un selector remoto si su volumen ralentiza el formulario.
    return tx.tenant.findMany({ where: { status: 'ACTIVE' }, select: { id: true, name: true }, orderBy: [{ name: 'asc' }, { id: 'asc' }] });
  });
}
export async function createTenant(actor: Actor, input: { name: string }) {
  const name = nameSchema.parse(input.name);
  return prisma.$transaction(async tx => {
    const admin = await currentActor(tx, actor, true);
    const tenant = await tx.tenant.create({ data: { name } });
    await audit(tx, 'TENANT_CREATED', admin.id, tenant.id);
    return tenant;
  });
}
export async function setTenantStatus(actor: Actor, id: string, status: 'ACTIVE' | 'SUSPENDED') {
  z.enum(['ACTIVE', 'SUSPENDED']).parse(status);
  return prisma.$transaction(async tx => {
    const admin = await currentActor(tx, actor, true);
    const tenant = await tx.tenant.update({ where: { id }, data: { status } });
    if (status === 'SUSPENDED') await tx.user.updateMany({ where: { tenantId: id }, data: { sessionVersion: { increment: 1 } } });
    await audit(tx, `TENANT_${status}`, admin.id, id);
    return tenant;
  });
}
export async function listUsers(actor: Actor, options: UserListQuery = userListQuerySchema.parse({})) {
  const query = userListQuerySchema.parse(options);
  return prisma.$transaction(async tx => {
    const user = await currentActor(tx, actor);
    const where: Prisma.UserWhereInput = {
      ...(user.role === 'ADMIN' ? {} : { tenantId: user.tenantId! }),
      ...(query.q ? { OR: [{ name: { contains: query.q, mode: 'insensitive' } }, { email: { contains: query.q, mode: 'insensitive' } }] } : {}),
      ...(query.estado ? { status: query.estado } : {}), ...(query.rol ? { role: query.rol } : {}),
      ...(query.cuenta ? { tenant: { name: { contains: query.cuenta, mode: 'insensitive' } } } : {}),
    };
    const total = await tx.user.count({ where });
    const page = Math.min(query.page, Math.max(1, Math.ceil(total / query.pageSize)));
    const rows = await tx.user.findMany({ where, select: { ...safeUser, tenant: { select: { name: true } } }, orderBy: [{ createdAt: 'desc' }, { id: 'asc' }], skip: (page - 1) * query.pageSize, take: query.pageSize });
    return { rows, total, page, pageSize: query.pageSize };
  }, { isolationLevel: 'RepeatableRead' });
}
export async function inviteUser(actor: Actor, input: { email: string; name: string; tenantId: string }) {
  const email = emailSchema.parse(input.email.trim());
  const name = nameSchema.parse(input.name);
  return prisma.$transaction(async tx => {
    const admin = await currentActor(tx, actor, true);
    const tenant = await tx.tenant.findUnique({ where: { id: input.tenantId } });
    if (!tenant || tenant.status !== 'ACTIVE') throw new Error('Selecciona una cuenta activa.');
    const existing = await tx.user.findUnique({ where: { email } });
    if (existing && (existing.status !== 'INVITED' || existing.tenantId !== tenant.id || existing.role !== 'CLIENT')) throw new Error('El correo ya tiene un acceso registrado.');
    const user = existing ?? await tx.user.create({ data: { email, name, tenantId: tenant.id, role: 'CLIENT' } });
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${user.id}::uuid FOR UPDATE`;
    await tx.accessToken.updateMany({ where: { userId: user.id, purpose: 'INVITE', usedAt: null }, data: { usedAt: new Date() } });
    const token = randomBytes(32).toString('hex');
    const accessToken = await tx.accessToken.create({ data: { userId: user.id, purpose: 'INVITE', tokenHash: hashAccessToken(token), expiresAt: new Date(Date.now() + 48 * 3600000) } });
    await tx.accessEmailOutbox.create({ data: { recipient: email, purpose: 'INVITE', accessTokenId: accessToken.id, encryptedToken: encryptAccessToken(token, accessToken.id) } });
    await audit(tx, 'USER_INVITED', admin.id, user.id);
    return tx.user.findUniqueOrThrow({ where: { id: user.id }, select: safeUser });
  }, { timeout: 15000 });
}
export async function setUserStatus(actor: Actor, id: string, status: 'ACTIVE' | 'DISABLED') {
  z.enum(['ACTIVE', 'DISABLED']).parse(status);
  return prisma.$transaction(async tx => {
    const admin = await currentActor(tx, actor, true);
    if (admin.id === id && status === 'DISABLED') throw new Error('No puedes desactivar tu propio acceso.');
    const target = await tx.user.findUniqueOrThrow({ where: { id } });
    if (status === 'ACTIVE' && !target.passwordHash) throw new Error('El usuario debe activar su invitación.');
    const user = await tx.user.update({ where: { id }, data: { status, sessionVersion: { increment: 1 } }, select: safeUser });
    await audit(tx, `USER_${status}`, admin.id, id);
    return user;
  });
}
export async function revokeUserSessions(actor: Actor, id: string) {
  return prisma.$transaction(async tx => {
    const admin = await currentActor(tx, actor, true);
    await tx.user.update({ where: { id }, data: { sessionVersion: { increment: 1 } } });
    await audit(tx, 'SESSIONS_REVOKED', admin.id, id);
  });
}
export async function requestPasswordReset(email: string): Promise<void> {
  const parsed = emailSchema.safeParse(email.trim());
  if (!parsed.success) return;
  await prisma.$transaction(async tx => {
    const previous = await tx.accessEmailOutbox.findMany({ where: { recipient: parsed.data, purpose: 'RESET', accessTokenId: { not: null } }, select: { accessTokenId: true } });
    const tokenIds = previous.flatMap(item => item.accessTokenId ? [item.accessTokenId] : []);
    if (tokenIds.length) await tx.accessToken.updateMany({ where: { id: { in: tokenIds }, usedAt: null }, data: { usedAt: new Date() } });
    await tx.accessEmailOutbox.deleteMany({ where: { recipient: parsed.data, purpose: 'RESET' } });
    await tx.accessEmailOutbox.create({ data: { recipient: parsed.data, purpose: 'RESET' } });
  });
}
export async function getAccessTokenInfo(token: string): Promise<{ purpose: string; email: string } | null> {
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  const access = await prisma.accessToken.findUnique({ where: { tokenHash: hashAccessToken(token) }, include: { user: { include: { tenant: true } } } });
  if (!access || access.usedAt || access.expiresAt <= new Date() || access.user.status === 'DISABLED' || (access.user.role === 'CLIENT' && access.user.tenant?.status !== 'ACTIVE')) return null;
  return { purpose: access.purpose, email: access.user.email };
}
export async function consumeAccessToken(token: string, password: string): Promise<void> {
  if (!/^[a-f0-9]{64}$/.test(token)) throw new Error('El enlace no es válido o ha caducado.');
  const passwordHash = await hash(passwordSchema.parse(password), { type: argon2id });
  await prisma.$transaction(async tx => {
    const access = await tx.accessToken.findUnique({ where: { tokenHash: hashAccessToken(token) } });
    if (!access) throw new Error('El enlace no es válido o ha caducado.');
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${access.userId}::uuid FOR UPDATE`;
    const claimed = await tx.accessToken.updateMany({ where: { id: access.id, usedAt: null, expiresAt: { gt: new Date() } }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new Error('El enlace no es válido o ha caducado.');
    const user = await tx.user.findUniqueOrThrow({ where: { id: access.userId }, include: { tenant: true } });
    if (user.status === 'DISABLED' || (user.role === 'CLIENT' && user.tenant?.status !== 'ACTIVE') || (access.purpose === 'RESET' && user.status !== 'ACTIVE')) throw new Error('El acceso no está disponible.');
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, status: 'ACTIVE', sessionVersion: { increment: 1 } } });
    await tx.accessToken.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: new Date() } });
    await audit(tx, 'PASSWORD_CHANGED', user.id, user.id);
  });
}
