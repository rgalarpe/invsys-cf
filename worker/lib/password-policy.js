// Per the PRD: length matters, no forced symbol rules, block obvious passwords.
const COMMON = new Set([
  'password123', 'password1234', 'passw0rd123', '1234567890', '0123456789',
  '12345678910', 'qwertyuiop', 'qwerty12345', 'qwerty123456', 'iloveyou123',
  'admin12345', 'administrator', 'letmein1234', 'welcome1234', 'changeme123',
  'inventory123', 'abc1234567', '1q2w3e4r5t', 'password!23',
  'password', '123456', '123456789', 'qwerty', 'abc123', 'football', 'monkey', 'letmein', 'shadow', 'master', '666666',
  'qwertyuiop', '123321', 'mustang', '1234567', '12345678', '12345', 'dragon',
  'sunshine', 'princess', 'welcome', 'password1', 'admin', 'login', 'passw0rd',
  'starwars', 'hello', 'freedom', 'whatever', 'qazwsx', 'trustno1', '654321', 'jordan23',
  'harley', 'password1234', 'batman', 'football1', 'monkey1', 'letmein1', 'shadow1',
  'master1', '6666661', 'qwertyuiop1', '1233211', 'mustang1', '12345671', '12345681',
  '123451', 'dragon1', 'sunshine1', 'princess1', 'welcome1', 'password11', 'admin1', 'login1',
  'passw0rd1', 'starwars1', 'hello1', 'freedom1', 'whatever1', 'qazwsx1', 'trustno11',
  '6543211', 'jordan231', 'harley1', 'password12345', 'batman1', 'football12',
  'monkey12', 'letmein12', 'shadow12', 'master12', '66666612', 'qwertyuiop12', '12332112',
  'mustang12', '123456712', '123456812', '1234512', 'dragon12', 'sunshine12',
  'princess12', 'welcome12', 'password112', 'admin12', 'login12', 'passw0rd12',
  'starwars12', 'hello12', 'freedom12', 'whatever12', 'qazwsx12', 'trustno112',
  '65432112', 'jordan2312', 'harley12',
]);

export function checkPassword(pw, { email } = {}) {
  if (typeof pw !== 'string' || pw.length === 0) return 'Password is required';
  if (pw.length < 10) return 'Password must be at least 10 characters';
  if (pw.length > 200) return 'Password is too long';
  if (/^(.)\1+$/.test(pw)) return 'Password cannot be a single repeated character';
  if (COMMON.has(pw.toLowerCase())) return 'That password is too common';
  if (email && pw.toLowerCase() === String(email).toLowerCase()) {
    return 'Password cannot be the same as the email';
  }
  return null;
}