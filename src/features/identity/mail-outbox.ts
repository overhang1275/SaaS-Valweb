import { randomBytes } from 'node:crypto';
import { prisma } from '../../lib/prisma';
import { decryptAccessToken, encryptAccessToken, sendAccessEmail } from './mail';
import { hashAccessToken } from './tokens';

async function claimNext() {
  return prisma.$queryRaw<Array<{ id: string; attempts: number }>>`
    WITH candidate AS (
      SELECT "id" FROM "AccessEmailOutbox"
      WHERE "nextAttemptAt" <= now()
        AND ("lockedAt" IS NULL OR "lockedAt" < now() - interval '5 minutes')
      ORDER BY "createdAt"
      FOR UPDATE SKIP LOCKED
      LIMIT 1
    )
    UPDATE "AccessEmailOutbox" AS outbox
    SET "lockedAt" = now(), "attempts" = outbox."attempts" + 1
    FROM candidate
    WHERE outbox."id" = candidate."id"
    RETURNING outbox."id", outbox."attempts"
  `;
}

async function prepareResetEmail(id: string) {
  return prisma.$transaction(async tx => {
    const outbox = await tx.accessEmailOutbox.findUnique({ where: { id } });
    if (!outbox || outbox.accessTokenId || outbox.purpose !== 'RESET') return;
    const candidate = await tx.user.findUnique({ where: { email: outbox.recipient }, include: { tenant: true } });
    if (!candidate || candidate.status !== 'ACTIVE' || (candidate.role === 'CLIENT' && candidate.tenant?.status !== 'ACTIVE')) {
      await tx.accessEmailOutbox.delete({ where: { id } });
      return;
    }
    await tx.$queryRaw`SELECT id FROM "User" WHERE id = ${candidate.id}::uuid FOR UPDATE`;
    const user = await tx.user.findUnique({ where: { id: candidate.id }, include: { tenant: true } });
    if (!user || user.status !== 'ACTIVE' || (user.role === 'CLIENT' && user.tenant?.status !== 'ACTIVE')) {
      await tx.accessEmailOutbox.delete({ where: { id } });
      return;
    }
    await tx.accessToken.updateMany({ where: { userId: user.id, purpose: 'RESET', usedAt: null }, data: { usedAt: new Date() } });
    const token = randomBytes(32).toString('hex');
    const accessToken = await tx.accessToken.create({ data: { userId: user.id, purpose: 'RESET', tokenHash: hashAccessToken(token), expiresAt: new Date(Date.now() + 3600000) } });
    await tx.accessEmailOutbox.update({ where: { id }, data: { accessTokenId: accessToken.id, encryptedToken: encryptAccessToken(token, accessToken.id) } });
    await tx.auditLog.create({ data: { action: 'PASSWORD_RESET_REQUESTED', actorId: null, targetId: user.id } });
  });
}

function eligible(outbox: { accessToken: { usedAt: Date | null; expiresAt: Date; purpose: string; user: { status: string; role: string; tenant: { status: string } | null } } | null }) {
  const token = outbox.accessToken;
  return Boolean(token && !token.usedAt && token.expiresAt > new Date() && token.user.status !== 'DISABLED' && (token.purpose !== 'RESET' || token.user.status === 'ACTIVE') && (token.user.role !== 'CLIENT' || token.user.tenant?.status === 'ACTIVE'));
}

function errorCode(cause: unknown) {
  if (cause && typeof cause === 'object' && 'code' in cause && typeof cause.code === 'string') return cause.code.slice(0, 80);
  return cause instanceof Error ? cause.name.slice(0, 80) : 'DELIVERY_ERROR';
}

export async function processOneAccessEmail(): Promise<void> {
  const [claim] = await claimNext();
  if (!claim) return;
  try {
    let outbox = await prisma.accessEmailOutbox.findUnique({ where: { id: claim.id }, include: { accessToken: { include: { user: { include: { tenant: true } } } } } });
    if (!outbox) return;
    if (outbox.purpose === 'RESET' && !outbox.accessTokenId) {
      await prepareResetEmail(outbox.id);
      outbox = await prisma.accessEmailOutbox.findUnique({ where: { id: claim.id }, include: { accessToken: { include: { user: { include: { tenant: true } } } } } });
    }
    if (!outbox?.accessTokenId || !outbox.encryptedToken || !eligible(outbox)) {
      await prisma.accessEmailOutbox.deleteMany({ where: { id: claim.id } });
      return;
    }
    const token = decryptAccessToken(outbox.encryptedToken, outbox.accessTokenId);
    await sendAccessEmail(outbox.recipient, token, outbox.purpose);
    // shortcut: SMTP is at-least-once; a crash after server acceptance may send a duplicate on retry.
    await prisma.accessEmailOutbox.deleteMany({ where: { id: claim.id } });
  } catch (cause) {
    const seconds = Math.min(3600, 30 * 2 ** Math.min(claim.attempts - 1, 7));
    const code = errorCode(cause);
    await prisma.accessEmailOutbox.updateMany({ where: { id: claim.id }, data: { lockedAt: null, nextAttemptAt: new Date(Date.now() + seconds * 1000), lastErrorCode: code } });
    console.error(`ACCESS_EMAIL_RETRY ${code}`);
  }
}
