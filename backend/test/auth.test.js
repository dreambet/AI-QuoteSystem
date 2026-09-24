const test = require('node:test');
const assert = require('node:assert/strict');
const AuthService = require('../src/services/AuthService');

test('管理员密码采用不可逆哈希并可验证', async () => {
  const hash = await AuthService.hashPassword('correct-horse-battery-staple');
  assert.match(hash, /^scrypt\$/);
  assert.equal(await AuthService.verifyPassword('correct-horse-battery-staple', hash), true);
  assert.equal(await AuthService.verifyPassword('wrong-password-value', hash), false);
});

test('密码不限制长度，但不能为空', () => {
  assert.equal(AuthService.validatePassword('a'), null);
  assert.equal(AuthService.validatePassword('任意长度的密码均可'), null);
  assert.equal(AuthService.validatePassword(''), '密码不能为空');
});

test('签名令牌不能被篡改', () => {
  const before = process.env.AUTH_TOKEN_SECRET;
  process.env.AUTH_TOKEN_SECRET = 'this-is-a-test-secret-with-at-least-32-characters';
  const token = AuthService.signToken({ id: 7, username: 'admin', role: 'admin', tokenVersion: 0 });
  assert.equal(AuthService.verifyToken(token).username, 'admin');
  assert.equal(AuthService.verifyToken(`${token}x`), null);
  if (before === undefined) delete process.env.AUTH_TOKEN_SECRET;
  else process.env.AUTH_TOKEN_SECRET = before;
});
