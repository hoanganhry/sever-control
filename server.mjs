import { createServer } from 'node:http';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const publicDir = join(here, 'public');
const dataDir = resolve(process.env.DATA_DIR || join(here, '.data'));
const stateFile = join(dataDir, 'menu-settings.json');
const port = Number(process.env.PORT || 10000);
const adminPassword = process.env.ADMIN_PASSWORD || '';
const clientToken = process.env.CLIENT_API_TOKEN || '';
const sessionSecret = process.env.SESSION_SECRET || '';
const sessionLifetimeMs = 12 * 60 * 60 * 1000;
const sessions = new Map();
const loginAttempts = new Map();
let lastClientSeenAt = null;
let state;

const featureKeys = [
  'esp', 'box', 'cornerBox', 'box3d', 'playerName', 'healthBar', 'distance',
  'skeleton', 'headMarker', 'xyz', 'line', 'aimbot', 'silentAim', 'fovCircle',
  'aimLine', 'autoFire', 'aimKill', 'aimlagScope', 'hideAutofireAnimation',
  'noReload', 'rapidFire', 'noRecoil', 'enemyCounter', 'runSpeedX5'
];

function defaultState() {
  const features = Object.fromEntries(featureKeys.map(key => [key, false]));
  return {
    revision: 1,
    updatedAt: new Date().toISOString(),
    settings: {
      features,
      aim: { fov: 150, range: 150, headChance: 100, targetPart: 0 },
      esp: { range: 150, lineOrigin: 0, healthStyle: 1 },
      visuals: { fovOpacity: 1, fovThickness: 2 }
    }
  };
}

function timingSafeStringEqual(left, right) {
  const a = Buffer.from(String(left));
  const b = Buffer.from(String(right));
  return a.length > 0 && a.length === b.length && timingSafeEqual(a, b);
}

function normalizeSettings(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
  const features = input.features;
  const aim = input.aim;
  const esp = input.esp;
  const visuals = input.visuals;
  if (![features, aim, esp, visuals].every(value => value && typeof value === 'object' && !Array.isArray(value))) return null;

  const cleanFeatures = {};
  for (const key of featureKeys) {
    if (typeof features[key] !== 'boolean') return null;
    cleanFeatures[key] = features[key];
  }
  // Keep combinations consistent with the in-game menu's own toggle rules.
  if (cleanFeatures.box3d) cleanFeatures.cornerBox = false;
  if (cleanFeatures.aimbot) cleanFeatures.silentAim = false;
  if (cleanFeatures.silentAim) cleanFeatures.aimbot = false;
  if (cleanFeatures.aimKill) cleanFeatures.autoFire = false;

  const boundedNumber = (value, min, max) => {
    if (typeof value !== 'number' || !Number.isFinite(value)) return null;
    return Math.min(max, Math.max(min, value));
  };
  const boundedInteger = (value, min, max) => {
    if (!Number.isInteger(value)) return null;
    return Math.min(max, Math.max(min, value));
  };
  const cleanAim = {
    fov: boundedNumber(aim.fov, 20, 480),
    range: boundedNumber(aim.range, 50, 500),
    headChance: boundedInteger(aim.headChance, 0, 100),
    targetPart: boundedInteger(aim.targetPart, 0, 2)
  };
  const cleanEsp = {
    range: boundedInteger(esp.range, 30, 500),
    lineOrigin: esp.lineOrigin === 2 ? 2 : esp.lineOrigin === 0 ? 0 : null,
    healthStyle: boundedInteger(esp.healthStyle, 0, 2)
  };
  const cleanVisuals = {
    fovOpacity: boundedNumber(visuals.fovOpacity, 0.1, 1),
    fovThickness: boundedNumber(visuals.fovThickness, 1, 5)
  };
  if (Object.values(cleanAim).some(value => value === null) ||
      Object.values(cleanEsp).some(value => value === null) ||
      Object.values(cleanVisuals).some(value => value === null)) return null;
  return { features: cleanFeatures, aim: cleanAim, esp: cleanEsp, visuals: cleanVisuals };
}

async function persist(nextState) {
  const tempFile = `${stateFile}.${randomBytes(6).toString('hex')}.tmp`;
  await writeFile(tempFile, JSON.stringify(nextState, null, 2), { mode: 0o600 });
  await rename(tempFile, stateFile);
}

async function loadState() {
  await mkdir(dataDir, { recursive: true });
  try {
    const saved = JSON.parse(await readFile(stateFile, 'utf8'));
    const settings = normalizeSettings(saved?.settings);
    const revision = Number.isSafeInteger(saved?.revision) && saved.revision >= 1 ? saved.revision : 1;
    if (!settings) throw new Error('Saved settings are invalid');
    return { revision, updatedAt: String(saved.updatedAt || new Date().toISOString()), settings };
  } catch (error) {
    if (error.code !== 'ENOENT') console.error('Could not load saved settings; using defaults:', error.message);
    const initial = defaultState();
    await persist(initial);
    return initial;
  }
}

function sendJson(res, status, body, extraHeaders = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store, private',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(data);
}

function sendText(res, status, body, extraHeaders = {}) {
  const data = Buffer.from(body);
  res.writeHead(status, {
    'content-type': 'text/plain; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...extraHeaders
  });
  res.end(data);
}

async function readJson(req, maxBytes = 16_384) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > maxBytes) throw Object.assign(new Error('Request body too large'), { status: 413 });
    chunks.push(chunk);
  }
  try {
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('JSON object required');
    return body;
  } catch {
    throw Object.assign(new Error('Invalid JSON body'), { status: 400 });
  }
}

function getSession(req) {
  const cookieHeader = req.headers.cookie || '';
  const sessionCookie = cookieHeader.split(';').map(part => part.trim()).find(part => part.startsWith('pb_session='));
  if (!sessionCookie) return null;
  const token = decodeURIComponent(sessionCookie.slice('pb_session='.length));
  const session = sessions.get(token);
  if (!session || session.expiresAt <= Date.now()) {
    sessions.delete(token);
    return null;
  }
  return { token, ...session };
}

function isAdmin(req, res, needsCsrf = false) {
  const session = getSession(req);
  if (!session) {
    sendJson(res, 401, { error: 'login_required' });
    return false;
  }
  if (needsCsrf && !timingSafeStringEqual(req.headers['x-csrf-token'] || '', session.csrf)) {
    sendJson(res, 403, { error: 'csrf_failed' });
    return false;
  }
  req.adminSession = session;
  return true;
}

function isClient(req) {
  const authorization = req.headers.authorization || '';
  const match = /^Bearer\s+(.+)$/i.exec(authorization);
  return Boolean(match && timingSafeStringEqual(match[1], clientToken));
}

function securityHeaders(req, res) {
  res.setHeader('referrer-policy', 'no-referrer');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
  if (process.env.NODE_ENV === 'production') res.setHeader('strict-transport-security', 'max-age=31536000; includeSubDomains');
}

const contentTypes = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml'
};

async function serveStatic(pathname, res) {
  const name = pathname === '/' ? 'index.html' : pathname.slice(1);
  if (!['index.html', 'app.js', 'styles.css'].includes(name)) return false;
  try {
    const data = await readFile(join(publicDir, name));
    res.writeHead(200, {
      'content-type': contentTypes[extname(name)],
      'content-length': data.length,
      'cache-control': name === 'index.html' ? 'no-cache' : 'public, max-age=300',
      'x-content-type-options': 'nosniff'
    });
    res.end(data);
    return true;
  } catch {
    return false;
  }
}

function clientOnline() {
  if (!lastClientSeenAt) return false;
  return Date.now() - Date.parse(lastClientSeenAt) < 35_000;
}

async function handle(req, res) {
  securityHeaders(req, res);
  const url = new URL(req.url, 'http://localhost');
  const pathname = url.pathname;

  if (req.method === 'GET' && pathname === '/healthz') return sendJson(res, 200, { ok: true });

  if (req.method === 'POST' && pathname === '/api/admin/login') {
    if (!adminPassword) return sendJson(res, 503, { error: 'admin_password_not_configured' });
    const ip = req.socket.remoteAddress || 'unknown';
    const attempts = loginAttempts.get(ip) || { count: 0, resetAt: 0 };
    if (attempts.resetAt <= Date.now()) {
      attempts.count = 0;
      attempts.resetAt = Date.now() + 15 * 60 * 1000;
    }
    if (attempts.count >= 8) return sendJson(res, 429, { error: 'too_many_attempts' }, { 'retry-after': '900' });
    attempts.count += 1;
    loginAttempts.set(ip, attempts);
    const body = await readJson(req);
    if (!timingSafeStringEqual(body.password || '', adminPassword)) return sendJson(res, 401, { error: 'invalid_credentials' });
    loginAttempts.delete(ip);
    const token = createHmac('sha256', sessionSecret).update(randomBytes(32)).digest('base64url');
    const csrf = randomBytes(24).toString('base64url');
    const expiresAt = Date.now() + sessionLifetimeMs;
    sessions.set(token, { csrf, expiresAt });
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    return sendJson(res, 200, { ok: true, csrf, expiresAt }, {
      'set-cookie': `pb_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200${secure}`
    });
  }

  if (req.method === 'GET' && pathname === '/api/admin/state') {
    if (!isAdmin(req, res)) return;
    return sendJson(res, 200, { ...state, csrf: req.adminSession.csrf, client: { online: clientOnline(), lastSeenAt: lastClientSeenAt } });
  }

  if (req.method === 'PUT' && pathname === '/api/admin/state') {
    if (!isAdmin(req, res, true)) return;
    const body = await readJson(req);
    const settings = normalizeSettings(body.settings);
    if (!settings) return sendJson(res, 400, { error: 'invalid_settings' });
    const next = {
      revision: state.revision + 1,
      updatedAt: new Date().toISOString(),
      settings
    };
    await persist(next);
    state = next;
    return sendJson(res, 200, { ...state, client: { online: clientOnline(), lastSeenAt: lastClientSeenAt } });
  }

  if (req.method === 'POST' && pathname === '/api/admin/logout') {
    if (!isAdmin(req, res, true)) return;
    sessions.delete(req.adminSession.token);
    return sendJson(res, 200, { ok: true }, {
      'set-cookie': 'pb_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0' + (process.env.NODE_ENV === 'production' ? '; Secure' : '')
    });
  }

  if (req.method === 'GET' && pathname === '/api/client/settings') {
    if (!clientToken || !isClient(req)) return sendJson(res, 401, { error: 'unauthorized' });
    lastClientSeenAt = new Date().toISOString();
    return sendJson(res, 200, state);
  }

  if (req.method === 'GET' && await serveStatic(pathname, res)) return;
  return sendText(res, 404, 'Not found');
}

async function start() {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT');
  if (!adminPassword || adminPassword.length < 20) throw new Error('Set ADMIN_PASSWORD to a random value with at least 20 characters');
  if (!clientToken || clientToken.length < 24) throw new Error('Set CLIENT_API_TOKEN to a random value with at least 24 characters');
  if (!sessionSecret || sessionSecret.length < 32) throw new Error('Set SESSION_SECRET to a random value with at least 32 characters');
  state = await loadState();
  const server = createServer((req, res) => {
    handle(req, res).catch(error => {
      console.error('Request failed:', error.message);
      if (!res.headersSent) sendJson(res, error.status || 500, { error: error.status ? error.message : 'server_error' });
      else res.destroy();
    });
  });
  server.listen(port, '0.0.0.0', () => console.log(`PatchBuild Control is listening on ${port}`));
}

start().catch(error => {
  console.error(error.message);
  process.exitCode = 1;
});
