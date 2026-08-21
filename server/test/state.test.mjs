import test from 'node:test';
import assert from 'node:assert/strict';
import { ControlState } from '../src/state.mjs';

const fakeWs = () => ({ readyState: 1, sent: [], send(v) { this.sent.push(JSON.parse(v)); } });

test('human takeover preempts agent with a new fencing token', () => {
  const s = new ControlState();
  s.registerDevice('p1', fakeWs());
  const a = s.acquireAgent('p1', 'worker');
  const h = s.takeHuman('p1', 'operator');
  assert.equal(h.mode, 'HUMAN');
  assert.ok(h.fencingToken > a.fencingToken);
  assert.throws(() => s.acquireAgent('p1', 'worker'), /DEVICE_CONTROLLED_BY_HUMAN/);
});

test('release returns device to free state', () => {
  const s = new ControlState();
  s.registerDevice('p1', fakeWs());
  s.takeHuman('p1', 'operator');
  const lease = s.release('p1');
  assert.equal(lease.mode, 'FREE');
});

test('a restarted server can start from a newer fencing epoch', () => {
  const oldServer = new ControlState({ initialFencingToken: 100 });
  oldServer.registerDevice('p1', fakeWs());
  const oldLease = oldServer.takeHuman('p1', 'operator');

  const restartedServer = new ControlState({ initialFencingToken: 1_000 });
  restartedServer.registerDevice('p1', fakeWs());
  const newLease = restartedServer.takeHuman('p1', 'operator');

  assert.ok(newLease.fencingToken > oldLease.fencingToken);
});
