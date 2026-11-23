import { hashPassword } from '../worker/lib/password.js';

const [email, name, role, flag] = process.argv.slice(2);
const password = process.env.ADMIN_PASSWORD ?? '';
const hidden = flag === 'hidden';

const problems = [];
if (!email || !email.includes('@')) {
  problems.push(`Email looks wrong: "${email ?? ''}". It must be a real address containing an @ (is the placeholder still there?)`);
}
if (!name) problems.push('Name is missing');
if (!['admin', 'user'].includes(role)) {
  problems.push(`Role must be "admin" or "user", but got "${role ?? ''}"`);
}
if (flag && !hidden) {
  problems.push(`The last argument must be "hidden" or left out, but got "${flag}"`);
}
if (password.length < 10) {
  problems.push(
    `The password reaching this script is ${password.length} characters (needs at least 10).` +
      (password.length === 0 ? ' ADMIN_PASSWORD is empty in this terminal.' : '')
  );
}

if (problems.length) {
  console.error('Could not create the account:');
  for (const p of problems) console.error(`  - ${p}`);
  console.error('\nUsage: node scripts/create-admin.mjs EMAIL "Name" admin|user [hidden]');
  process.exit(1);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const { hash, salt, iterations } = await hashPassword(password);

console.log(
  `INSERT INTO users (email, name, role, password_hash, password_salt, password_iterations, must_change_password, is_hidden) ` +
  `VALUES (${q(email.toLowerCase())}, ${q(name)}, ${q(role)}, ${q(hash)}, ${q(salt)}, ${iterations}, 0, ${hidden ? 1 : 0});`
);