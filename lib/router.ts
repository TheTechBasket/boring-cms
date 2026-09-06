// Tiny hand-written router for node:http. No Express, no dependencies.

export class Router {
  routes: any[];

  constructor() {
    this.routes = []; // { method, pattern: RegExp, keys: string[], handler }
  }

  add(method, path, handler) {
    const keys = [];
    const pattern = new RegExp(
      '^' +
        path
          .split('/')
          .map((seg) => {
            if (seg.startsWith(':')) {
              keys.push(seg.slice(1));
              return '([^/]+)';
            }
            return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
          })
          .join('/') +
        '/?$',
    );
    this.routes.push({ method, pattern, keys, handler });
  }

  get(path, handler) {
    this.add('GET', path, handler);
  }

  post(path, handler) {
    this.add('POST', path, handler);
  }

  match(method, pathname) {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const m = route.pattern.exec(pathname);
      if (!m) continue;
      const params = {};
      route.keys.forEach((key, i) => {
        params[key] = decodeURIComponent(m[i + 1]);
      });
      return { handler: route.handler, params };
    }
    return null;
  }
}

export async function readBody(req, { limit = 1024 * 1024 } = {}) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw new Error('Request body too large');
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString('utf8');
}

export async function readFormBody(req) {
  const raw = await readBody(req);
  const params = new URLSearchParams(raw);
  return Object.fromEntries(params.entries());
}

export function parseCookies(req) {
  const header = req.headers.cookie;
  const out = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key) out[key] = decodeURIComponent(value);
  }
  return out;
}

export function setCookie(res, name, value, { maxAgeSeconds, httpOnly = true, secure = false }: { maxAgeSeconds?: number; httpOnly?: boolean; secure?: boolean } = {}) {
  let cookie = `${name}=${encodeURIComponent(value)}; Path=/; SameSite=Lax`;
  if (httpOnly) cookie += '; HttpOnly';
  if (secure) cookie += '; Secure';
  if (typeof maxAgeSeconds === 'number') cookie += `; Max-Age=${maxAgeSeconds}`;
  const prev = res.getHeader('Set-Cookie');
  if (prev) {
    res.setHeader('Set-Cookie', Array.isArray(prev) ? [...prev, cookie] : [prev, cookie]);
  } else {
    res.setHeader('Set-Cookie', cookie);
  }
}

export function clearCookie(res, name) {
  setCookie(res, name, '', { maxAgeSeconds: 0 });
}
