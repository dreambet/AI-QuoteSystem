const crypto = require('crypto');
const { promisify } = require('util');

const scrypt = promisify(crypto.scrypt);
const TOKEN_TTL_SECONDS = Math.max(900, Number(process.env.AUTH_TOKEN_TTL_SECONDS) || 8 * 60 * 60);

const base64url = value => Buffer.from(value).toString('base64url');
const fromBase64url = value => Buffer.from(value, 'base64url').toString('utf8');

class AuthService {
  static get tokenSecret() {
    return process.env.AUTH_TOKEN_SECRET || '';
  }

  static assertConfigured() {
    if (process.env.NODE_ENV === 'production' && this.tokenSecret.length < 32) {
      throw new Error('生产环境必须配置至少 32 位的 AUTH_TOKEN_SECRET');
    }
  }

  static normalizeUsername(value) {
    const username = String(value || '').trim();
    return /^[a-zA-Z0-9_.-]{3,64}$/.test(username) ? username : null;
  }

  static validatePassword(value) {
    const password = String(value || '');
    return password.length ? null : '密码不能为空';
  }

  static async hashPassword(password) {
    const failure = this.validatePassword(password);
    if (failure) throw new Error(failure);
    const salt = crypto.randomBytes(16).toString('base64url');
    const derived = await scrypt(password, salt, 64);
    return `scrypt$${salt}$${derived.toString('base64url')}`;
  }

  static async verifyPassword(password, storedHash) {
    const [algorithm, salt, digest] = String(storedHash || '').split('$');
    if (algorithm !== 'scrypt' || !salt || !digest) return false;
    const expected = Buffer.from(digest, 'base64url');
    const actual = await scrypt(String(password || ''), salt, expected.length);
    return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
  }

  static signToken(user) {
    if (!this.tokenSecret) throw new Error('AUTH_TOKEN_SECRET 尚未配置');
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      tokenVersion: Number(user.tokenVersion || 0),
      iat: now,
      exp: now + TOKEN_TTL_SECONDS
    };
    const body = base64url(JSON.stringify(payload));
    const signature = crypto.createHmac('sha256', this.tokenSecret).update(body).digest('base64url');
    return `${body}.${signature}`;
  }

  static verifyToken(token) {
    const [body, signature] = String(token || '').split('.');
    if (!body || !signature || !this.tokenSecret) return null;
    const expected = crypto.createHmac('sha256', this.tokenSecret).update(body).digest('base64url');
    const a = Buffer.from(signature);
    const b = Buffer.from(expected);
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
    try {
      const payload = JSON.parse(fromBase64url(body));
      if (!payload.sub || !payload.exp || payload.exp <= Math.floor(Date.now() / 1000)) return null;
      return payload;
    } catch (_) {
      return null;
    }
  }

  static publicUser(user) {
    return { id: user.id, username: user.username, role: user.role, lastLoginAt: user.lastLoginAt || null };
  }
}

module.exports = AuthService;
