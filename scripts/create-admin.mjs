import { hashPassword } from '../worker/lib/password.js';

const [email, name, roleArg] = process.argv.slice(2);
const role = roleArg === 'user' ? 'user' : 'admin';

const password = process.env.ADMIN_PASSWORD;

if (!email || !name || !password || password.length < 10) {
  console.error('Usage: ADMIN_PASSWORD="at-least-10-chars" node scripts/create-admin.mjs you@example.com "Your Name"');
  process.exit(1);
}

const q = (s) => `'${String(s).replace(/'/g, "''")}'`;
const { hash, salt, iterations } = await hashPassword(password);

console.log(
  `INSERT INTO users (email, name, role, password_hash, password_salt, password_iterations, must_change_password) ` +
  `VALUES (${q(email.toLowerCase())}, ${q(name)}, ${q(role)}, ${q(hash)}, ${q(salt)}, ${iterations}, 0);`
);