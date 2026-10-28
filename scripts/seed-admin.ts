import 'dotenv/config';
import { argon2id, hash } from 'argon2';
import { z } from 'zod';
import { prisma } from '../src/lib/prisma';

async function main() {
  const email = z.email().parse(process.env.ADMIN_EMAIL).toLowerCase();
  const password = z.string().min(12).max(128).parse(process.env.ADMIN_PASSWORD);
  const name = z.string().trim().min(1).max(120).parse(process.env.ADMIN_NAME ?? 'Administrador');
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) {
    if (existing.role !== 'ADMIN') throw new Error('El correo ya pertenece a un usuario cliente.');
    console.info('El administrador ya existe; su contraseña no se modificó.');
    return;
  }
  await prisma.user.create({ data: { email, name, role: 'ADMIN', status: 'ACTIVE', passwordHash: await hash(password, { type: argon2id }) } });
  console.info('Administrador creado.');
}
main().catch(() => { console.error('No se pudo crear el administrador. Comprueba ADMIN_EMAIL y ADMIN_PASSWORD (mínimo 12 caracteres) y la conexión.'); process.exitCode = 1; }).finally(() => prisma.$disconnect());
