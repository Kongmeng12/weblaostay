/**
 * Creates or promotes an admin account.
 *
 *   node scripts/create-admin.mjs someone@example.com super_admin "Their Name"
 *
 * `db:reset` rebuilds everything from the SQL files, so the only accounts that
 * survive a rebuild are the three seeded ones. This is how the real people get
 * put back — and the only supported way to make an admin at all, since nothing
 * in the app can grant the first one.
 *
 * An existing account is promoted rather than duplicated: the email is unique,
 * and a partner or customer being made staff is a normal thing to want.
 *
 * The password is read from ADMIN_PASSWORD, or generated and printed once.
 */
import { PrismaClient } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import bcrypt from 'bcrypt';

const [email, role = 'staff', fullName] = process.argv.slice(2);

const ROLES = ['super_admin', 'finance', 'staff'];
if (!email || !email.includes('@')) {
  console.error('\nUsage: node scripts/create-admin.mjs <email> [super_admin|finance|staff] [name]\n');
  process.exit(1);
}
if (!ROLES.includes(role)) {
  console.error(`\nUnknown role "${role}". Use one of: ${ROLES.join(', ')}\n`);
  process.exit(1);
}

const prisma = new PrismaClient();
const address = email.trim().toLowerCase();

// Generated rather than defaulted: a shared default password on an admin
// account is how a staging box becomes an incident.
const password = process.env.ADMIN_PASSWORD ?? `Ls-${randomBytes(9).toString('base64url')}`;
const password_hash = await bcrypt.hash(password, 10);

const existing = await prisma.users.findUnique({ where: { email: address } });

const user = existing
  ? await prisma.users.update({
      where: { email: address },
      data: {
        role: 'ADMIN',
        admin_role: role,
        status: 'active',
        deleted_at: null,
        // An existing password is left alone unless one was asked for, so
        // promoting somebody does not lock them out of their own account.
        ...(process.env.ADMIN_PASSWORD ? { password_hash } : {}),
      },
    })
  : await prisma.users.create({
      data: {
        email: address,
        role: 'ADMIN',
        admin_role: role,
        password_hash,
        is_verified: true,
        user_profiles: { create: { full_name: fullName ?? address.split('@')[0] } },
      },
    });

console.log(`\n  ${existing ? 'Promoted' : 'Created'}  ${user.email}  ->  ${role}`);
if (!existing || process.env.ADMIN_PASSWORD) {
  console.log(`  Password  ${password}`);
  if (!process.env.ADMIN_PASSWORD) console.log('  (shown once — write it down now)');
} else {
  console.log('  Password  unchanged');
}
console.log('');

await prisma.$disconnect();
