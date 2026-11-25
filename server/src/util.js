import crypto from 'node:crypto';

export const sha256 = (s) => crypto.createHash('sha256').update(Buffer.isBuffer(s) ? s : String(s)).digest('hex');

export function hashPassword(pw) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pw), salt, 64).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

export function verifyPassword(pw, stored) {
  const [, salt, hash] = String(stored).split('$');
  if (!salt || !hash) return false;
  const test = crypto.scryptSync(String(pw), salt, 64);
  const real = Buffer.from(hash, 'hex');
  return real.length === test.length && crypto.timingSafeEqual(real, test);
}

export const randomToken = () => crypto.randomBytes(32).toString('hex');

/** Parse comma-separated IPv4 CIDRs ("192.168.10.0/24,10.0.0.5"). Empty → null (allow all). */
export function parseCidrs(spec) {
  if (!spec || !spec.trim()) return null;
  return spec.split(',').map((s) => s.trim()).filter(Boolean).map((c) => {
    const [ip, bits = '32'] = c.split('/');
    const n = Number(bits);
    const mask = n === 0 ? 0 : (~0 << (32 - n)) >>> 0;
    return { base: (ipToInt(ip) & mask) >>> 0, mask };
  });
}

function ipToInt(ip) {
  const p = ip.split('.').map(Number);
  if (p.length !== 4 || p.some((x) => !(x >= 0 && x <= 255))) return -1;
  return ((p[0] << 24) | (p[1] << 16) | (p[2] << 8) | p[3]) >>> 0;
}

export function normalizeIp(ip) {
  if (!ip) return '';
  if (ip.startsWith('::ffff:')) return ip.slice(7);
  if (ip === '::1') return '127.0.0.1';
  return ip;
}

export function ipAllowed(cidrs, rawIp) {
  if (!cidrs) return true;
  const ip = normalizeIp(rawIp);
  if (ip === '127.0.0.1') return true;
  const n = ipToInt(ip);
  if (n < 0) return false;
  return cidrs.some(({ base, mask }) => ((n & mask) >>> 0) === base);
}

export const todayKey = (t = Date.now()) => {
  const d = new Date(t);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
