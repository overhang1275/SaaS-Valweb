import { createHash } from 'node:crypto';
import { prisma } from '../../lib/prisma';

export async function limitRequest(scope: string, key: string, limit: number, windowSeconds: number): Promise<boolean> {
  if (!Number.isInteger(limit) || limit < 1 || !Number.isInteger(windowSeconds) || windowSeconds < 1) throw new Error('Invalid rate limit');
  const bucketKey = `${scope}:${createHash('sha256').update(key).digest('hex')}`;
  const now = new Date();
  const expiresAt = new Date(now.getTime() + windowSeconds * 1000);
  const [bucket] = await prisma.$queryRaw<Array<{ count: number }>>`
    INSERT INTO "RateLimitBucket" ("key", "count", "expiresAt") VALUES (${bucketKey}, 1, ${expiresAt})
    ON CONFLICT ("key") DO UPDATE SET
      "count" = CASE WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN 1 ELSE "RateLimitBucket"."count" + 1 END,
      "expiresAt" = CASE WHEN "RateLimitBucket"."expiresAt" <= ${now} THEN ${expiresAt} ELSE "RateLimitBucket"."expiresAt" END
    RETURNING "count"`;
  return bucket.count <= limit;
}
