import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlState } from '../src/state.mjs';
import { DeviceSentinel } from '../src/sentinel.mjs';

const fakeWs = (readyState = 1) => ({
  readyState,
  terminated: false,
  closed: false,
  pingCount: 0,
  terminate() {
    this.terminated = true;
    this.readyState = 3;
  },
  close(code, reason) {
    this.closed = true;
    this.closeCode = code;
    this.closeReason = reason;
    this.readyState = 3;
  },
  ping() {
    this.pingCount += 1;
  },
});

test('DeviceSentinel assesses device readiness correctly', () => {
  const state = new ControlState();
  const sentinel = new DeviceSentinel({ state });

  // 1. Offline device
  const d1 = state.registerDevice('dev-offline', null);
  const a1 = sentinel.assessDevice(d1);
  assert.equal(a1.online, false);
  assert.equal(a1.readiness, 'OFFLINE');

  // 2. Fully ready device (Accessibility + Live Screen)
  const d2 = state.registerDevice('dev-ready', fakeWs(), { accessibilityReady: true });
  state.touch('dev-ready', { liveReady: true });
  const a2 = sentinel.assessDevice(state.getDevice('dev-ready'));
  assert.equal(a2.online, true);
  assert.equal(a2.readiness, 'READY');
  assert.equal(a2.accessibilityReady, true);
  assert.equal(a2.liveReady, true);

  // 3. Partial ready device (Accessibility only)
  const d3 = state.registerDevice('dev-partial', fakeWs(), { accessibilityReady: true });
  const a3 = sentinel.assessDevice(d3);
  assert.equal(a3.online, true);
  assert.equal(a3.readiness, 'PARTIAL');
  assert.equal(a3.accessibilityReady, true);
  assert.equal(a3.liveReady, false);
});

test('DeviceSentinel detects stale heartbeat and evicts zombie connections', () => {
  const state = new ControlState();
  const timedOutIds = [];
  const sentinel = new DeviceSentinel({
    state,
    timeoutMs: 1000,
    onDeviceTimeout: (id) => timedOutIds.push(id),
  });

  const ws = fakeWs(1);
  const device = state.registerDevice('dev-stale', ws, { accessibilityReady: true });
  // Manually make lastSeen older than timeoutMs
  device.lastSeen = Date.now() - 2000;

  sentinel.tick();

  assert.equal(ws.terminated, true);
  assert.equal(timedOutIds.includes('dev-stale'), true);
  assert.equal(device.ws, null); // Unregistered from state
});

test('DeviceSentinel generates aggregated summary and health metrics', () => {
  const state = new ControlState();
  const sentinel = new DeviceSentinel({ state });

  state.registerDevice('dev-1', fakeWs(1), { accessibilityReady: true });
  state.touch('dev-1', { liveReady: true });

  state.registerDevice('dev-2', fakeWs(1), { accessibilityReady: false });

  const summary = sentinel.getSummary();
  assert.equal(summary.ok, true);
  assert.equal(summary.metrics.totalDevices, 2);
  assert.equal(summary.metrics.onlineDevices, 2);
  assert.equal(summary.metrics.readyDevices, 1);
  assert.equal(summary.devices.length, 2);
});

test('DeviceSentinel broadcasts to SSE subscribers', () => {
  const state = new ControlState();
  const sentinel = new DeviceSentinel({ state });

  const chunks = [];
  const fakeRes = {
    writeHead() {},
    write(chunk) {
      chunks.push(chunk);
    },
    end() {},
  };
  const fakeReq = {
    on() {},
  };

  sentinel.registerSseClient(fakeReq, fakeRes);
  assert.equal(chunks.length, 1); // init event sent
  assert.ok(chunks[0].startsWith('event: init\n'));

  sentinel.broadcast('test_event', { hello: 'world' });
  assert.equal(chunks.length, 2);
  assert.equal(chunks[1], 'event: test_event\ndata: {"hello":"world"}\n\n');

  sentinel.stop();
});
