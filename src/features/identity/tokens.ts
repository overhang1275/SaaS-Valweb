import { createHash } from 'node:crypto';

export const hashAccessToken = (token: string) => createHash('sha256').update(token).digest('hex');
