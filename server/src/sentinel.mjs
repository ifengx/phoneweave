/**
 * Device Sentinel for PhoneWeave Control Server.
 * Monitors device connections, detects zombie/stale WebSockets, assesses
 * readiness for immediate human/agent takeover, and broadcasts live events.
 */

export class DeviceSentinel {
  constructor({
    state,
    timeoutMs = 35_000,
    checkIntervalMs = 10_000,
    onDeviceTimeout = null,
  } = {}) {
    this.state = state;
    this.timeoutMs = timeoutMs;
    this.checkIntervalMs = checkIntervalMs;
    this.onDeviceTimeout = onDeviceTimeout;
    this.timer = null;
    this.sseClients = new Set();
    this.startedAt = Date.now();
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), this.checkIntervalMs);
    if (this.timer.unref) this.timer.unref();
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (const client of this.sseClients) {
      try {
        client.end();
      } catch {}
    }
    this.sseClients.clear();
  }

  tick() {
    const now = Date.now();
    for (const [id, device] of this.state.devices.entries()) {
      const isSocketOpen = Boolean(device.ws && device.ws.readyState === 1);
      if (!isSocketOpen) continue;

      const lastSeenAgo = now - (device.lastSeen || 0);
      if (lastSeenAgo > this.timeoutMs) {
        console.warn(`[Sentinel] Device ${id} heartbeat timeout (${lastSeenAgo}ms > ${this.timeoutMs}ms). Evicting stale connection.`);
        try {
          if (typeof device.ws.terminate === 'function') {
            device.ws.terminate();
          } else {
            device.ws.close(1001, 'heartbeat_timeout');
          }
        } catch {}

        this.state.unregisterDevice(id, device.ws);
        if (typeof this.onDeviceTimeout === 'function') {
          try {
            this.onDeviceTimeout(id, device);
          } catch {}
        }
        this.broadcast('device_status', {
          deviceId: id,
          status: 'OFFLINE',
          device: this.state.serializeDevice(device),
        });
      } else {
        // Send a lightweight ping frame if supported to keep NAT/firewalls alive
        try {
          if (typeof device.ws.ping === 'function') {
            device.ws.ping();
          }
        } catch {}
      }
    }
  }

  assessDevice(device) {
    const online = Boolean(device.ws && device.ws.readyState === 1);
    const accessibilityReady = Boolean(device.meta?.accessibilityReady);
    const liveReady = Boolean(device.liveReady);

    let readiness = 'OFFLINE';
    if (online) {
      if (accessibilityReady && liveReady) {
        readiness = 'READY';
      } else if (accessibilityReady || liveReady) {
        readiness = 'PARTIAL';
      } else {
        readiness = 'BASIC';
      }
    }

    const now = Date.now();
    return {
      id: device.id,
      online,
      readiness,
      accessibilityReady,
      liveReady,
      fileUpload: Boolean(device.meta?.fileUpload),
      leaseMode: device.lease?.mode || 'FREE',
      lastSeenMsAgo: Math.max(0, now - (device.lastSeen || now)),
      uptimeMs: online && device.connectedAt ? Math.max(0, now - device.connectedAt) : 0,
      model: device.meta?.model || 'Unknown',
      ip: device.meta?.ip || null,
      agentVersion: device.meta?.agentVersionName || null,
    };
  }

  getSummary() {
    const devices = [];
    let onlineCount = 0;
    let readyCount = 0;

    for (const device of this.state.devices.values()) {
      this.state.expireAgentLease(device);
      const assessed = this.assessDevice(device);
      if (assessed.online) onlineCount += 1;
      if (assessed.readiness === 'READY') readyCount += 1;
      devices.push(assessed);
    }

    return {
      ok: true,
      sentinel: {
        active: Boolean(this.timer),
        uptimeMs: Date.now() - this.startedAt,
        timeoutMs: this.timeoutMs,
        checkIntervalMs: this.checkIntervalMs,
        sseSubscribers: this.sseClients.size,
      },
      metrics: {
        totalDevices: devices.length,
        onlineDevices: onlineCount,
        readyDevices: readyCount,
      },
      devices,
    };
  }

  registerSseClient(req, res) {
    res.writeHead(200, {
      'content-type': 'text/event-stream',
      'cache-control': 'no-cache, no-transform',
      'connection': 'keep-alive',
      'x-accel-buffering': 'no',
    });
    res.write(`event: init\ndata: ${JSON.stringify(this.getSummary())}\n\n`);

    this.sseClients.add(res);
    req.on('close', () => {
      this.sseClients.delete(res);
    });
  }

  broadcast(event, data) {
    if (!this.sseClients.size) return;
    const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of this.sseClients) {
      try {
        client.write(payload);
      } catch {
        this.sseClients.delete(client);
      }
    }
  }
}
