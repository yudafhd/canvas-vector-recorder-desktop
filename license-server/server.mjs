import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const port = Number(process.env.PORT || 8787); const activations = new Map();
function json(response, status, body) { response.writeHead(status, { 'content-type': 'application/json' }); response.end(JSON.stringify(body)); }
const server = createServer((request, response) => {
  if (request.method !== 'POST' || !['/v1/activate', '/v1/check'].includes(request.url)) return json(response, 404, { ok: false, message: 'not found' });
  let body = ''; request.on('data', chunk => { body += chunk; if (body.length > 100_000) request.destroy(); }); request.on('end', () => {
    let input; try { input = JSON.parse(body); } catch { return json(response, 400, { ok: false, message: 'invalid json' }); }
    if (request.url === '/v1/activate') {
      if (!input.email || !input.license_code || !input.device_id) return json(response, 400, { ok: false, message: 'email, license_code, and device_id are required' });
      const key = `${input.email}:${input.license_code}`; const existing = activations.get(key) || new Set(); if (existing.size >= 1 && !existing.has(input.device_id)) return json(response, 409, { ok: false, message: 'device limit reached' }); existing.add(input.device_id); activations.set(key, existing);
      return json(response, 200, { ok: true, activation_token: `mock-${randomUUID()}`, expires_at: null, next_check_at: new Date(Date.now() + 7 * 86_400_000).toISOString() });
    }
    return json(response, 200, { ok: true, next_check_at: new Date(Date.now() + 7 * 86_400_000).toISOString() });
  });
});
server.listen(port, () => console.log(`Development license server listening on http://127.0.0.1:${port}`));
