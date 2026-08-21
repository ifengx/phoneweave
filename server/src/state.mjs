import crypto from 'node:crypto';

// A fresh server process must always fence commands issued before a restart.
// Date.now() * 1000 stays within JavaScript's safe integer range and reserves
// ample room for per-process lease increments.
const PROCESS_FENCING_EPOCH = Date.now() * 1000;

export class ControlState {
  constructor({ agentLeaseMs = 30_000, initialFencingToken = PROCESS_FENCING_EPOCH } = {}) {
    this.devices = new Map();
    this.pendingActions = new Map();
    this.agentLeaseMs = agentLeaseMs;
    this.initialFencingToken = initialFencingToken;
  }

  registerDevice(id, ws, meta = {}) {
    const previous = this.devices.get(id);
    const device = {
      id,
      ws,
      meta: { ...(previous?.meta ?? {}), ...meta },
      connectedAt: Date.now(),
      lastSeen: Date.now(),
      lease: previous?.lease ?? { mode: 'FREE', owner: null, fencingToken: this.initialFencingToken, expiresAt: 0 },
      liveReady: previous?.liveReady ?? false,
      lastError: null,
    };
    this.devices.set(id, device);
    return device;
  }

  unregisterDevice(id, ws) {
    const current = this.devices.get(id);
    if (current?.ws === ws) {
      current.ws = null;
      current.lastSeen = Date.now();
      current.liveReady = false;
    }
  }

  touch(id, patch = {}) {
    const d = this.devices.get(id);
    if (!d) return null;
    Object.assign(d, patch);
    d.lastSeen = Date.now();
    return d;
  }

  getDevice(id) {
    const d = this.devices.get(id);
    if (!d) return null;
    this.expireAgentLease(d);
    return d;
  }

  listDevices() {
    return [...this.devices.values()].map(d => {
      this.expireAgentLease(d);
      return this.serializeDevice(d);
    });
  }

  serializeDevice(d) {
    return {
      id: d.id,
      online: Boolean(d.ws && d.ws.readyState === 1),
      meta: d.meta,
      connectedAt: d.connectedAt,
      lastSeen: d.lastSeen,
      liveReady: Boolean(d.liveReady),
      lease: { ...d.lease },
      lastError: d.lastError,
    };
  }

  expireAgentLease(d) {
    if (d.lease.mode === 'AGENT' && d.lease.expiresAt > 0 && d.lease.expiresAt < Date.now()) {
      d.lease = {
        mode: 'FREE',
        owner: null,
        fencingToken: d.lease.fencingToken + 1,
        expiresAt: 0,
      };
    }
  }

  takeHuman(id, owner = 'human') {
    const d = this.getDevice(id);
    if (!d) throw new Error('DEVICE_NOT_FOUND');
    d.lease = {
      mode: 'HUMAN',
      owner,
      fencingToken: d.lease.fencingToken + 1,
      expiresAt: 0,
    };
    return { ...d.lease };
  }

  release(id, owner = null) {
    const d = this.getDevice(id);
    if (!d) throw new Error('DEVICE_NOT_FOUND');
    if (owner && d.lease.owner && d.lease.owner !== owner) throw new Error('LEASE_OWNER_MISMATCH');
    d.lease = {
      mode: 'FREE',
      owner: null,
      fencingToken: d.lease.fencingToken + 1,
      expiresAt: 0,
    };
    return { ...d.lease };
  }

  acquireAgent(id, owner = 'agent') {
    const d = this.getDevice(id);
    if (!d) throw new Error('DEVICE_NOT_FOUND');
    if (d.lease.mode === 'HUMAN') throw new Error('DEVICE_CONTROLLED_BY_HUMAN');
    if (d.lease.mode !== 'AGENT' || d.lease.owner !== owner) {
      d.lease = {
        mode: 'AGENT',
        owner,
        fencingToken: d.lease.fencingToken + 1,
        expiresAt: Date.now() + this.agentLeaseMs,
      };
    } else {
      d.lease.expiresAt = Date.now() + this.agentLeaseMs;
    }
    return { ...d.lease };
  }

  createAction(id, payload, { source = 'agent', owner = 'agent', timeoutMs = 15_000 } = {}) {
    const d = this.getDevice(id);
    if (!d || !d.ws || d.ws.readyState !== 1) throw new Error('DEVICE_OFFLINE');
    let lease;
    if (source === 'human') {
      if (d.lease.mode !== 'HUMAN') throw new Error('HUMAN_LEASE_REQUIRED');
      lease = { ...d.lease };
    } else {
      lease = this.acquireAgent(id, owner);
    }

    const actionId = crypto.randomUUID();
    const startedAt = Date.now();
    const envelope = {
      type: 'action',
      actionId,
      fencingToken: lease.fencingToken,
      payload,
    };

    const promise = new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingActions.delete(actionId);
        reject(new Error('ACTION_TIMEOUT'));
      }, timeoutMs);
      this.pendingActions.set(actionId, { id, payload, startedAt, resolve, reject, timer });
    });

    d.ws.send(JSON.stringify(envelope));
    return { actionId, lease, promise, startedAt };
  }

  resolveAction(message) {
    const pending = this.pendingActions.get(message.actionId);
    if (!pending) return false;
    clearTimeout(pending.timer);
    this.pendingActions.delete(message.actionId);
    const durationMs = Date.now() - (pending.startedAt || Date.now());
    pending.resolve({ ...message, durationMs, payload: pending.payload });
    return true;
  }
}
