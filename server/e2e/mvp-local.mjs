import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import WebSocket from 'ws';

const baseUrl = process.env.PHONEWEAVE_BASE_URL || 'http://localhost:8787';
const adminToken = process.env.PHONEWEAVE_ADMIN_TOKEN || 'change-me-admin';
const requestedDeviceId = process.env.PHONEWEAVE_DEVICE_ID || '';

const apiResponse = await fetch(`${baseUrl}/api/devices`, { headers: { 'x-admin-token': adminToken } });
assert.equal(apiResponse.ok, true, `device API returned HTTP ${apiResponse.status}`);
const { devices } = await apiResponse.json();
const device = requestedDeviceId
  ? devices.find(item => item.id === requestedDeviceId)
  : devices.find(item => item.online);
assert.ok(device?.online, 'no online Android device found');
assert.equal(device.meta?.accessibilityReady, true, 'Android Accessibility service is not ready');

const wsUrl = new URL(baseUrl);
wsUrl.protocol = wsUrl.protocol === 'https:' ? 'wss:' : 'ws:';
wsUrl.pathname = '/ws/human';
wsUrl.search = new URLSearchParams({ deviceId: device.id, token: adminToken }).toString();

const ws = new WebSocket(wsUrl);
const history = [];
const waiters = new Set();

ws.on('message', raw => {
  const message = JSON.parse(raw.toString());
  history.push(message);
  for (const waiter of [...waiters]) {
    if (!waiter.predicate(message)) continue;
    clearTimeout(waiter.timer);
    waiters.delete(waiter);
    waiter.resolve(message);
  }
});

function waitFor(predicate, timeoutMs = 20_000) {
  const existing = history.findLast(predicate);
  if (existing) return Promise.resolve(existing);
  return new Promise((resolve, reject) => {
    const waiter = { predicate, resolve, timer: null };
    waiter.timer = setTimeout(() => {
      waiters.delete(waiter);
      reject(new Error('protocol response timeout'));
    }, timeoutMs);
    waiters.add(waiter);
  });
}

function send(message) {
  ws.send(JSON.stringify(message));
}

async function action(payload) {
  const requestId = crypto.randomUUID();
  const responsePromise = waitFor(message => message.type === 'human_action_result' && message.requestId === requestId);
  send({ type: 'action', requestId, payload });
  const response = await responsePromise;
  assert.equal(response.result?.ok, true, `${payload.type} failed: ${response.result?.error || 'unknown error'}`);
  return response.result;
}

async function snapshotHash(label) {
  const result = await action({ type: 'snapshot', quality: 72 });
  const bytes = Buffer.from(result.data.imageBase64, 'base64');
  assert.ok(bytes.length > 10_000, `${label} snapshot is unexpectedly small`);
  return { label, bytes: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex') };
}

function findTapTarget(tree) {
  const active = tree.windows?.find(window => window.active) || tree.windows?.[0];
  const candidates = [];
  function visit(node) {
    if (!node) return;
    const bounds = node.bounds || {};
    const width = (bounds.right || 0) - (bounds.left || 0);
    const height = (bounds.bottom || 0) - (bounds.top || 0);
    if (node.clickable && node.enabled && width > 20 && height > 20 && bounds.top >= 80 && bounds.bottom <= device.meta.screenHeight - 100) {
      candidates.push(node);
    }
    for (const child of node.children || []) visit(child);
  }
  visit(active?.root);
  const preferred = candidates.find(node => /PhoneWeave|Settings|Play Store|Chrome/i.test(`${node.text || ''} ${node.contentDescription || ''}`));
  return preferred || candidates.find(node => node.text || node.contentDescription) || candidates[0];
}

try {
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });
  await waitFor(message => message.type === 'device_status');

  const humanLease = waitFor(message => message.type === 'lease' && message.lease?.mode === 'HUMAN');
  send({ type: 'takeover' });
  await humanLease;

  const before = await snapshotHash('before');
  await action({ type: 'home' });
  await new Promise(resolve => setTimeout(resolve, 800));
  const home = await snapshotHash('home');
  assert.notEqual(home.sha256, before.sha256, 'Home action did not change the Android screen');

  const uiResult = await action({ type: 'ui_tree' });
  const target = findTapTarget(uiResult.data);
  assert.ok(target, 'no safe clickable launcher target found in UI Tree');
  const x = Math.round((target.bounds.left + target.bounds.right) / 2);
  const y = Math.round((target.bounds.top + target.bounds.bottom) / 2);
  await action({ type: 'tap', x, y });
  await new Promise(resolve => setTimeout(resolve, 1_000));
  const tapped = await snapshotHash('tapped');
  assert.notEqual(tapped.sha256, home.sha256, 'Tap action did not change the Android screen');

  const freeLease = waitFor(message => message.type === 'lease' && message.lease?.mode === 'FREE');
  send({ type: 'release' });
  await freeLease;

  console.log(JSON.stringify({
    ok: true,
    device: { id: device.id, model: device.meta.model, sdk: device.meta.sdk, screen: `${device.meta.screenWidth}x${device.meta.screenHeight}` },
    transport: 'human-websocket + accessibility-snapshot',
    frames: [before, home, tapped],
    tapTarget: { text: target.text, contentDescription: target.contentDescription, x, y },
    leaseReleased: true,
  }, null, 2));
} finally {
  ws.close();
}
