import { PrismaClient } from '../generated/prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
const globalPrisma = globalThis as unknown as { prisma?: PrismaClient };
export const prisma = globalPrisma.prisma ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL, options: "-c timezone=UTC" }) });
if (process.env.NODE_ENV !== 'production') globalPrisma.prisma = prisma;
