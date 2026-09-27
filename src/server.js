import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { randomUUID, timingSafeEqual } from 'node:crypto';

const types = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function send(res, status, payload, type = 'application/json; charset=utf-8') {
  const data = typeof payload === 'string' ? payload : JSON.stringify(payload);
  res.writeHead(status, { 'content-type': type, 'content-length': Buffer.byteLength(data), 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'" }); res.end(data);
}
async function readJson(req) {
  const chunks = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > 65536) throw Object.assign(new Error('Request body too large'), { code: 'PAYLOAD_TOO_LARGE' }); chunks.push(chunk); }
  try {
    const data = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : {};
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Expected an object');
    return data;
  } catch { throw Object.assign(new Error('Invalid JSON object'), { code: 'INVALID_JSON' }); }
}
function authorized(candidate, expected) {
  if (typeof candidate !== 'string' || !expected) return false;
  const a = Buffer.from(candidate), b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}
export function createServer({ service, apiKey, mesh = null }) {
  const root = path.resolve('public');
  const attempts = new Map();
  return http.createServer(async (req, res) => {
    const requestId = randomUUID();
    try {
      const url = new URL(req.url, 'http://localhost'); const p = url.pathname, method = req.method;
      if (method === 'GET' && (p === '/' || ['/app.js', '/styles.css'].includes(p))) {
        const file = path.join(root, p === '/' ? 'index.html' : p.slice(1));
        return send(res, 200, fs.readFileSync(file, 'utf8'), types[path.extname(file)]);
      }
      if (p === '/health' && method === 'GET') return send(res, 200, { ok: true, service: 'aifp4-mesh', version: '0.3.0', nodeId: mesh?.nodeId ?? null });
      const now = Date.now(), ip = req.socket.remoteAddress ?? 'unknown';
      if (attempts.size > 10000) {
        for (const [key, entry] of attempts) if (entry.until <= now) attempts.delete(key);
        while (attempts.size > 10000) attempts.delete(attempts.keys().next().value);
      }
      const bucket = attempts.get(ip);
      const current = bucket && bucket.until > now ? bucket : { count: 0, until: now + 60000 };
      current.count++;
      attempts.set(ip, current);
      if (current.count > 300) { res.setHeader('retry-after', String(Math.ceil((current.until - now) / 1000))); return send(res, 429, { error: 'RATE_LIMITED', requestId }); }
      if (!authorized(req.headers['x-aifp4-api-key'], apiKey)) return send(res, 401, { error: 'UNAUTHORIZED', requestId });
      if (method === 'GET' && p === '/v1/stats') return send(res, 200, service.stats());
      if (method === 'GET' && p === '/v1/routes') return send(res, 200, { routes: service.listRoutes({ asset: url.searchParams.get('asset') ?? undefined }) });
      if (method === 'POST' && p === '/v1/mesh/network') { const data = await readJson(req); if (typeof data.online !== 'boolean') return send(res, 422, { error: 'INVALID_INPUT', requestId }); return send(res, 200, { routes: service.setMockOnline(data.online) }); }
      if (method === 'POST' && p === '/v1/mesh/reconcile') {
        if (mesh) { await mesh.tick(); return send(res, 200, { reconciled: await Promise.all(service.store.all('intents').filter(i=>i.state==='queued_for_mesh').map(i=>mesh.dispatch(i.id))) }); }
        return send(res, 200, { reconciled: await service.reconcileQueued() });
      }
      if (mesh && method === 'GET' && p === '/v1/mesh/node') return send(res, 200, mesh.snapshot().node);
      if (mesh && method === 'GET' && ['/v1/mesh/peers','/v1/mesh/links','/v1/mesh/routes','/v1/mesh/topology','/v1/mesh/transports','/v1/mesh/queue','/v1/mesh/messages','/v1/mesh/deliveries'].includes(p)) {
        const key=p.split('/').at(-1), snapshot=mesh.snapshot();
        return send(res, 200, { [key]: key==='transports'?snapshot.node.transports:snapshot[key] });
      }
      const transportControl=p.match(/^\/v1\/mesh\/transports\/(tcp)$/);
      if(mesh && method==='POST' && transportControl) return send(res,200,await mesh.setTransportOnline(transportControl[1],(await readJson(req)).online));
      for (const [segment, kind] of [['agents', 'agents'], ['policies', 'policies'], ['intents', 'intents'], ['transactions', 'transactions'], ['receipts', 'receipts']]) {
        if (method === 'GET' && p === `/v1/${segment}`) return send(res, 200, { [kind]: service.store.all(kind).slice(-100).reverse() });
      }
      if (method === 'POST' && p === '/v1/agents') return send(res, 201, service.createAgent(await readJson(req)));
      if (method === 'POST' && p === '/v1/policies') return send(res, 201, service.createPolicy(await readJson(req)));
      if (method === 'POST' && p === '/v1/intents') { const intent=service.createIntent(await readJson(req)); return send(res, 201, intent); }
      const agentPolicy = p.match(/^\/v1\/agents\/([^/]+)\/policy$/);
      if (agentPolicy && method === 'PUT') return send(res, 200, service.assignPolicy(agentPolicy[1], (await readJson(req)).policyId));
      const detail = p.match(/^\/v1\/(agents|intents|receipts)\/([^/]+)$/);
      if (detail && method === 'GET') { const item = detail[1] === 'intents' ? service.store.get(detail[2]) : detail[1] === 'receipts' ? service.store.all('receipts').find(x => x.receiptId === detail[2]) : service.store.find('agents', detail[2]); return item ? send(res, 200, item) : send(res, 404, { error: 'NOT_FOUND', requestId }); }
      const pathDetail=p.match(/^\/v1\/intents\/([^/]+)\/path$/);
      if (mesh && method === 'GET' && pathDetail) { const item=service.store.get(pathDetail[1]); return item?send(res,200,{meshPath:item.meshPath??[],transportPath:item.transportPath??[],receiptVerified:item.receiptVerified??false}):send(res,404,{error:'NOT_FOUND',requestId}); }
      const execute = p.match(/^\/v1\/intents\/([^/]+)\/execute$/);
      if (execute && method === 'POST') return send(res, 200, mesh ? await mesh.dispatch(execute[1]) : await service.execute(execute[1]));
      return send(res, 404, { error: 'NOT_FOUND', requestId });
    } catch (error) {
      const status = error.code === 'PAYLOAD_TOO_LARGE' ? 413 : error.code === 'INTENT_NOT_FOUND' ? 404 : ['IDEMPOTENCY_CONFLICT', 'EXECUTION_UNCERTAIN', 'DAILY_LIMIT_EXCEEDED', 'TRANSACTION_COUNT_EXCEEDED'].includes(error.code) ? 409 : error.name === 'PolicyError' || error.code === 'INVALID_JSON' ? 422 : 500;
      return send(res, status, { error: error.code ?? 'INTERNAL_ERROR', message: status === 500 ? 'Internal error' : error.message, requestId });
    }
  });
}
