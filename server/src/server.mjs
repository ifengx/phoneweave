import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { ControlState } from './state.mjs';
import { FileTransferBroker } from './file-transfer.mjs';
import { createWebAuth } from './web-auth.mjs';
import { DeviceSentinel } from './sentinel.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const WEB_DIST = path.resolve(__dirname, '../../web-console/dist');
const WEB_ROOT = fs.existsSync(WEB_DIST) ? WEB_DIST : null;
const PORT = Number(process.env.PORT || 8787);
const ADMIN_TOKEN = process.env.PHONEWEAVE_ADMIN_TOKEN || 'change-me-admin';
const DEVICE_TOKEN = process.env.PHONEWEAVE_DEVICE_TOKEN || 'change-me-device';
const WEB_TOKEN = process.env.WEB_TOKEN || '';
const STUN_URL = process.env.STUN_URL || 'stun:stun.l.google.com:19302';
const TURN_URL = process.env.TURN_URL || '';
const TURN_USER = process.env.TURN_USER || '';
const TURN_PASSWORD = process.env.TURN_PASSWORD || '';
const configuredRequestTimeoutMs = Number(process.env.PHONEWEAVE_HTTP_REQUEST_TIMEOUT_MS || 30 * 60 * 1000);
const HTTP_REQUEST_TIMEOUT_MS = Number.isFinite(configuredRequestTimeoutMs) && configuredRequestTimeoutMs > 0
  ? configuredRequestTimeoutMs
  : 30 * 60 * 1000;
const LATEST_AGENT_VERSION = Object.freeze({
  name: process.env.PHONEWEAVE_AGENT_VERSION_NAME || 'unknown',
  code: Number(process.env.PHONEWEAVE_AGENT_VERSION_CODE || 0),
});
const webAuth = createWebAuth({
  webToken: WEB_TOKEN,
  ttlSeconds: Number(process.env.WEB_SESSION_TTL_SECONDS || 12 * 60 * 60),
});

const state = new ControlState();
const fileTransfers = new FileTransferBroker({
  maxBytes: Number(process.env.PHONEWEAVE_MAX_UPLOAD_BYTES || 512 * 1024 * 1024),
});
const sentinel = new DeviceSentinel({
  state,
  timeoutMs: Number(process.env.PHONEWEAVE_SENTINEL_TIMEOUT_MS || 35_000),
  checkIntervalMs: Number(process.env.PHONEWEAVE_SENTINEL_INTERVAL_MS || 10_000),
  onDeviceTimeout: (id) => {
    fileTransfers.rejectDevice(id);
    notifyHumans(id, { type: 'device_status', device: safeDevice(state.getDevice(id)) });
  },
});
sentinel.start();
const humans = new Map(); // deviceId -> Set<WebSocket>
const loginAttempts = new Map(); // client address -> { count, resetAt }

function json(res, status, body, headers = {}) {
  const data = Buffer.from(JSON.stringify(body));
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': data.length,
    'cache-control': 'no-store',
    ...headers,
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', chunk => {
      size += chunk.length;
      if (size > 2 * 1024 * 1024) {
        reject(new Error('BODY_TOO_LARGE'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!chunks.length) return resolve({});
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); }
      catch { reject(new Error('INVALID_JSON')); }
    });
    req.on('error', reject);
  });
}

function adminAuthorized(req, url) {
  const header = req.headers['x-admin-token'];
  const query = url.searchParams.get('token');
  return header === ADMIN_TOKEN || query === ADMIN_TOKEN;
}

function operatorAuthorized(req, url) {
  return adminAuthorized(req, url) || webAuth.sessionAuthorized(req);
}

function clientAddress(req) {
  return String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || 'unknown').split(',')[0].trim();
}

function loginBlocked(req) {
  const key = clientAddress(req);
  const attempt = loginAttempts.get(key);
  if (!attempt || attempt.resetAt <= Date.now()) {
    loginAttempts.delete(key);
    return false;
  }
  return attempt.count >= 5;
}

function recordLoginFailure(req) {
  const key = clientAddress(req);
  const current = loginAttempts.get(key);
  const active = current && current.resetAt > Date.now() ? current : { count: 0, resetAt: Date.now() + 5 * 60 * 1000 };
  active.count += 1;
  loginAttempts.set(key, active);
}

function clearLoginFailures(req) {
  loginAttempts.delete(clientAddress(req));
}

function iceServers() {
  const result = [];
  if (STUN_URL) result.push({ urls: [STUN_URL] });
  if (TURN_URL) result.push({ urls: [TURN_URL], username: TURN_USER, credential: TURN_PASSWORD });
  return result;
}

function safeDevice(d) {
  return d ? state.serializeDevice(d) : null;
}

function notifyDeviceLease(deviceId, lease) {
  const d = state.getDevice(deviceId);
  if (d?.ws?.readyState === 1) d.ws.send(JSON.stringify({ type: 'lease_update', lease }));
}

function notifyHumans(deviceId, message) {
  const set = humans.get(deviceId);
  if (!set) return;
  const raw = JSON.stringify(message);
  for (const ws of set) {
    if (ws.readyState === 1) ws.send(raw);
  }
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

function serveStatic(req, res, url) {
  // In development the React/TSX source must be served by Vite (:5173).
  // The control server only serves a production Vite build from web-console/dist.
  if (!WEB_ROOT) return false;

  let rel = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\//, '');
  if (rel.includes('..')) return false;
  const file = path.join(WEB_ROOT, rel);
  if (!file.startsWith(WEB_ROOT) || !fs.existsSync(file) || !fs.statSync(file).isFile()) return false;
  const ext = path.extname(file).toLowerCase();
  const type = MIME_TYPES[ext] || 'application/octet-stream';
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
  fs.createReadStream(file).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);

  try {
    if (req.method === 'GET' && url.pathname === '/api/health') {
      return json(res, 200, { ok: true, name: 'PhoneWeave', version: '0.2.4-agent-version', latestAgentVersion: LATEST_AGENT_VERSION });
    }

    if (req.method === 'GET' && url.pathname === '/api/web/session') {
      return json(res, 200, { authenticated: webAuth.sessionAuthorized(req) });
    }

    if (req.method === 'POST' && url.pathname === '/api/web/login') {
      if (loginBlocked(req)) return json(res, 429, { error: 'TOO_MANY_LOGIN_ATTEMPTS' }, { 'retry-after': '300' });
      const body = await readJson(req);
      if (!webAuth.passwordMatches(body.token)) {
        recordLoginFailure(req);
        return json(res, 401, { error: 'INVALID_WEB_TOKEN' });
      }
      clearLoginFailures(req);
      return json(res, 200, { authenticated: true }, { 'set-cookie': webAuth.sessionCookie(req) });
    }

    if (req.method === 'POST' && url.pathname === '/api/web/logout') {
      return json(res, 200, { authenticated: false }, { 'set-cookie': webAuth.clearCookie(req) });
    }

    if (url.pathname.startsWith('/api/') && !operatorAuthorized(req, url)) {
      return json(res, 401, { error: 'UNAUTHORIZED' });
    }

    if (req.method === 'GET' && url.pathname === '/api/rtc-config') {
      return json(res, 200, { iceServers: iceServers() });
    }

    if (req.method === 'GET' && url.pathname === '/api/sentinel/summary') {
      return json(res, 200, sentinel.getSummary());
    }

    if (req.method === 'GET' && url.pathname === '/api/sentinel/stream') {
      return sentinel.registerSseClient(req, res);
    }

    if (req.method === 'GET' && url.pathname === '/api/devices') {
      return json(res, 200, { devices: state.listDevices(), latestAgentVersion: LATEST_AGENT_VERSION });
    }

    const deviceMatch = url.pathname.match(/^\/api\/devices\/([^/]+)$/);
    if (req.method === 'GET' && deviceMatch) {
      const d = state.getDevice(decodeURIComponent(deviceMatch[1]));
      return d ? json(res, 200, safeDevice(d)) : json(res, 404, { error: 'DEVICE_NOT_FOUND' });
    }

    const takeoverMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/takeover$/);
    if (req.method === 'POST' && takeoverMatch) {
      const id = decodeURIComponent(takeoverMatch[1]);
      const body = await readJson(req);
      const lease = state.takeHuman(id, body.owner || 'web-human');
      notifyDeviceLease(id, lease);
      notifyHumans(id, { type: 'lease', lease });
      return json(res, 200, { lease });
    }

    const releaseMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/release$/);
    if (req.method === 'POST' && releaseMatch) {
      const id = decodeURIComponent(releaseMatch[1]);
      const lease = state.release(id);
      notifyDeviceLease(id, lease);
      notifyHumans(id, { type: 'lease', lease });
      return json(res, 200, { lease });
    }

    const actionMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/action$/);
    if (req.method === 'POST' && actionMatch) {
      const id = decodeURIComponent(actionMatch[1]);
      const body = await readJson(req);
      const source = body.source === 'human' ? 'human' : 'agent';
      const owner = body.owner || (source === 'human' ? 'web-human' : 'api-agent');
      const { actionId, lease, promise } = state.createAction(id, body.action || body, { source, owner, timeoutMs: Number(body.timeoutMs || 15_000) });
      const result = await promise;
      return json(res, result.ok === false ? 409 : 200, { actionId, lease, result });
    }

    const fileUploadMatch = url.pathname.match(/^\/api\/devices\/([^/]+)\/files$/);
    if (req.method === 'POST' && fileUploadMatch) {
      const id = decodeURIComponent(fileUploadMatch[1]);
      const device = state.getDevice(id);
      if (!device?.ws || device.ws.readyState !== 1) throw new Error('DEVICE_OFFLINE');
      const advertisedMaxBytes = Number(device.meta?.maxUploadBytes);
      const deviceMaxBytes = Number.isFinite(advertisedMaxBytes) && advertisedMaxBytes > 0
        ? advertisedMaxBytes
        : fileTransfers.maxBytes;
      const result = await fileTransfers.upload({
        deviceId: id,
        ws: device.ws,
        stream: req,
        fileName: url.searchParams.get('name') || req.headers['x-file-name'],
        mimeType: req.headers['content-type'] || 'application/octet-stream',
        contentLength: req.headers['content-length'],
        maxBytes: deviceMaxBytes,
      });
      return json(res, 200, { ok: true, result });
    }

    if (req.method === 'GET' && !url.pathname.startsWith('/api/')) {
      if (serveStatic(req, res, url)) return;
      if (!WEB_ROOT && url.pathname === '/') {
        const body = Buffer.from(
          'PhoneWeave control server is running. In development open http://localhost:5173 (run ./phoneweave web-dev). For production run ./phoneweave web-build first.\n'
        );
        res.writeHead(503, {
          'content-type': 'text/plain; charset=utf-8',
          'content-length': body.length,
          'cache-control': 'no-store',
        });
        res.end(body);
        return;
      }
    }

    json(res, 404, { error: 'NOT_FOUND' });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message === 'DEVICE_CONTROLLED_BY_HUMAN' ? 423
      : message === 'DEVICE_NOT_FOUND' ? 404
      : message === 'DEVICE_OFFLINE' ? 503
      : message === 'HUMAN_LEASE_REQUIRED' ? 409
      : message === 'FILE_TOO_LARGE' ? 413
      : message === 'INVALID_CONTENT_LENGTH' || message === 'CONTENT_LENGTH_MISMATCH' ? 400
      : message === 'FILE_TRANSFER_TIMEOUT' ? 504
      : 500;
    json(res, status, { error: message });
  }
});
server.requestTimeout = HTTP_REQUEST_TIMEOUT_MS;

function formatActionSummary(payload) {
  if (!payload || typeof payload !== 'object') return 'unknown';
  switch (payload.type) {
    case 'tap':
      return `tap (${payload.x}, ${payload.y})`;
    case 'swipe':
      return `swipe (${payload.x1}, ${payload.y1}) ➔ (${payload.x2}, ${payload.y2}) [${payload.durationMs || 300}ms]`;
    case 'input_text':
      return `input_text "${payload.text?.slice(0, 30)}"`;
    case 'back':
      return 'key BACK';
    case 'home':
      return 'key HOME';
    case 'recents':
      return 'key RECENTS';
    case 'launch_app':
      return `launch_app "${payload.packageName}"`;
    default:
      return payload.type || 'unknown';
  }
}

const wss = new WebSocketServer({ noServer: true });
server.on('upgrade', (req, socket, head) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  if (url.pathname !== '/ws/device' && url.pathname !== '/ws/human') {
    socket.destroy(); return;
  }
  wss.handleUpgrade(req, socket, head, ws => wss.emit('connection', ws, req, url));
});

wss.on('connection', (ws, req, url) => {
  const deviceId = url.searchParams.get('deviceId') || '';
  const token = url.searchParams.get('token') || '';
  const role = url.pathname === '/ws/device' ? 'device' : 'human';

  if (!deviceId || (role === 'device' ? token !== DEVICE_TOKEN : !operatorAuthorized(req, url))) {
    ws.close(1008, 'unauthorized'); return;
  }

  if (role === 'device') {
    const d = state.registerDevice(deviceId, ws, {});
    console.log(`[Device: ${deviceId}] Connected from ${clientAddress(req)}`);
    ws.send(JSON.stringify({ type: 'welcome', deviceId, lease: d.lease, rtc: { iceServers: iceServers() } }));
    notifyHumans(deviceId, { type: 'device_status', device: safeDevice(d) });
    sentinel.broadcast('device_status', { deviceId, status: 'ONLINE', device: safeDevice(d) });

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      state.touch(deviceId);
      switch (msg.type) {
        case 'hello':
          console.log(`[Device: ${deviceId}] Hello: model=${msg.meta?.model || 'unknown'}, res=${msg.meta?.screenWidth}x${msg.meta?.screenHeight}, a11yReady=${msg.meta?.accessibilityReady}`);
          state.touch(deviceId, { meta: msg.meta || {}, liveReady: Boolean(msg.liveReady) });
          notifyHumans(deviceId, { type: 'device_status', device: safeDevice(state.getDevice(deviceId)) });
          sentinel.broadcast('device_status', { deviceId, status: 'ONLINE', device: safeDevice(state.getDevice(deviceId)) });
          break;
        case 'heartbeat':
          state.touch(deviceId, { liveReady: Boolean(msg.liveReady) });
          break;
        case 'action_result':
          state.resolveAction(msg);
          break;
        case 'file_upload_result':
          fileTransfers.resolve(msg);
          break;
        case 'screen_frame': {
          // Forward raw string to avoid JSON re-serialization of large base64 payloads
          const rawStr = raw.toString();
          const set = humans.get(deviceId);
          if (set) for (const h of set) { if (h.readyState === 1) h.send(rawStr); }
          break;
        }
        case 'webrtc_offer':
        case 'webrtc_ice':
        case 'webrtc_state':
          notifyHumans(deviceId, msg);
          break;
        default:
          break;
      }
    });
    ws.on('close', () => {
      console.log(`[Device: ${deviceId}] Disconnected`);
      fileTransfers.rejectDevice(deviceId);
      state.unregisterDevice(deviceId, ws);
      notifyHumans(deviceId, { type: 'device_status', device: safeDevice(state.getDevice(deviceId)) });
      sentinel.broadcast('device_status', { deviceId, status: 'OFFLINE', device: safeDevice(state.getDevice(deviceId)) });
    });
  } else {
    if (!humans.has(deviceId)) humans.set(deviceId, new Set());
    humans.get(deviceId).add(ws);
    console.log(`[Human: ${deviceId}] Operator connected from ${clientAddress(req)}`);
    const d = state.getDevice(deviceId);
    ws.send(JSON.stringify({ type: 'device_status', device: safeDevice(d), rtc: { iceServers: iceServers() } }));

    ws.on('message', raw => {
      let msg;
      try { msg = JSON.parse(raw.toString()); } catch { return; }
      const device = state.getDevice(deviceId);
      if (!device?.ws || device.ws.readyState !== 1) {
        ws.send(JSON.stringify({ type: 'error', error: 'DEVICE_OFFLINE' })); return;
      }
      if (msg.type === 'takeover') {
        const lease = state.takeHuman(deviceId, 'web-human');
        console.log(`[Human: ${deviceId}] Acquired HUMAN control lease (fencingToken=${lease.fencingToken})`);
        notifyDeviceLease(deviceId, lease);
        notifyHumans(deviceId, { type: 'lease', lease });
        return;
      }
      if (msg.type === 'release') {
        const lease = state.release(deviceId);
        console.log(`[Human: ${deviceId}] Released control lease`);
        notifyDeviceLease(deviceId, lease);
        notifyHumans(deviceId, { type: 'lease', lease });
        return;
      }
      if (msg.type === 'action') {
        const actionDesc = formatActionSummary(msg.payload);
        try {
          const { actionId, lease, promise, startedAt } = state.createAction(deviceId, msg.payload, { source: 'human', owner: 'web-human' });
          const shortId = actionId.slice(0, 8);
          console.log(`[Action ➔ ${deviceId}] ${actionDesc} [id=${shortId} token=${lease.fencingToken}]`);
          promise
            .then(result => {
              const duration = Date.now() - startedAt;
              if (result?.ok) {
                console.log(`[Action ✔ ${deviceId}] ${actionDesc} succeeded in ${duration}ms [id=${shortId}]`);
              } else {
                console.log(`[Action ✖ ${deviceId}] ${actionDesc} failed: ${result?.error || 'UNKNOWN_ERROR'} (${duration}ms) [id=${shortId}]`);
              }
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'human_action_result', requestId: msg.requestId, actionId, lease, result }));
              }
            })
            .catch(err => {
              const duration = Date.now() - startedAt;
              console.log(`[Action ✖ ${deviceId}] ${actionDesc} error: ${err.message} (${duration}ms) [id=${shortId}]`);
              if (ws.readyState === 1) {
                ws.send(JSON.stringify({ type: 'error', error: err.message }));
              }
            });
        } catch (err) {
          console.log(`[Action ✖ ${deviceId}] ${actionDesc} dispatch rejected: ${err.message}`);
          ws.send(JSON.stringify({ type: 'error', error: err.message }));
        }
        return;
      }
      if (['webrtc_start', 'webrtc_answer', 'webrtc_ice', 'webrtc_stop'].includes(msg.type)) {
        device.ws.send(JSON.stringify(msg));
      }
    });
    ws.on('close', () => {
      console.log(`[Human: ${deviceId}] Operator disconnected`);
      humans.get(deviceId)?.delete(ws);
      if (!humans.get(deviceId)?.size) {
        humans.delete(deviceId);
        const d = state.getDevice(deviceId);
        if (d?.lease?.mode === 'HUMAN' && d.lease.owner === 'web-human') {
          try {
            const lease = state.release(deviceId);
            notifyDeviceLease(deviceId, lease);
          } catch {}
        }
      }
    });
  }
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`[PhoneWeave] control server listening on :${PORT}`);
  if (WEB_ROOT) {
    console.log(`[PhoneWeave] production web console http://localhost:${PORT}/`);
  } else {
    console.log('[PhoneWeave] web console dev server: http://localhost:5173 (run ./phoneweave web-dev)');
  }
});
