import { McpServer } from '@modelcontextprotocol/server';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import * as z from 'zod/v4';

const baseUrl = process.env.PHONEWEAVE_BASE_URL || 'http://localhost:8787';
const adminToken = process.env.PHONEWEAVE_ADMIN_TOKEN || 'change-me-admin';

async function request(path, options = {}) {
  const headers = { ...(options.headers || {}), 'x-admin-token': adminToken };
  if (options.body && typeof options.body !== 'string') {
    headers['content-type'] = 'application/json';
    options.body = JSON.stringify(options.body);
  }
  const r = await fetch(`${baseUrl}${path}`, { ...options, headers });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP_${r.status}`);
  return data;
}

function text(data) {
  return { content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 2) }] };
}

function actionTool(server, name, description, schema, buildAction) {
  server.registerTool(name, { description, inputSchema: schema }, async input => {
    const { deviceId, ...rest } = input;
    const result = await request(`/api/devices/${encodeURIComponent(deviceId)}/action`, {
      method: 'POST',
      body: { source: 'agent', owner: 'mcp', action: buildAction(rest) },
    });
    return text(result);
  });
}

serveStdio(() => {
  const server = new McpServer({ name: 'phoneweave', version: '0.1.0' });

  server.registerTool('phoneweave_list_devices', {
    description: 'List real mobile devices connected to PhoneWeave.',
    inputSchema: z.object({}),
  }, async () => text(await request('/api/devices')));

  server.registerTool('phoneweave_device_status', {
    description: 'Get one PhoneWeave device status, capabilities and control lease.',
    inputSchema: z.object({ deviceId: z.string() }),
  }, async ({ deviceId }) => text(await request(`/api/devices/${encodeURIComponent(deviceId)}`)));

  actionTool(server, 'phoneweave_tap', 'Tap absolute device screen coordinates.', z.object({ deviceId: z.string(), x: z.number(), y: z.number() }), x => ({ type: 'tap', ...x }));
  actionTool(server, 'phoneweave_swipe', 'Swipe between absolute device screen coordinates.', z.object({ deviceId: z.string(), x1: z.number(), y1: z.number(), x2: z.number(), y2: z.number(), durationMs: z.number().optional() }), x => ({ type: 'swipe', durationMs: x.durationMs ?? 300, ...x }));
  actionTool(server, 'phoneweave_input_text', 'Set text into the currently focused editable field.', z.object({ deviceId: z.string(), text: z.string() }), x => ({ type: 'input_text', ...x }));
  actionTool(server, 'phoneweave_back', 'Press Android Back.', z.object({ deviceId: z.string() }), () => ({ type: 'back' }));
  actionTool(server, 'phoneweave_home', 'Press Android Home.', z.object({ deviceId: z.string() }), () => ({ type: 'home' }));
  actionTool(server, 'phoneweave_launch_app', 'Launch an Android app by package name.', z.object({ deviceId: z.string(), packageName: z.string() }), x => ({ type: 'launch_app', ...x }));
  actionTool(server, 'phoneweave_ui_tree', 'Read a bounded Android accessibility UI tree.', z.object({ deviceId: z.string() }), () => ({ type: 'ui_tree' }));
  actionTool(server, 'phoneweave_screenshot', 'Capture an on-demand Android screenshot. Returns base64 JPEG.', z.object({ deviceId: z.string(), quality: z.number().min(20).max(95).optional() }), x => ({ type: 'snapshot', quality: x.quality ?? 70 }));

  server.registerTool('phoneweave_release_agent', {
    description: 'Release the current PhoneWeave control lease so a human or another agent can take control.',
    inputSchema: z.object({ deviceId: z.string() }),
  }, async ({ deviceId }) => text(await request(`/api/devices/${encodeURIComponent(deviceId)}/release`, { method: 'POST', body: {} })));

  return server;
});
