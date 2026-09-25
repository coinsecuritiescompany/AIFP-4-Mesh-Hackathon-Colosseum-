import http from 'node:http';

function json(res, status, payload) {
  const body = JSON.stringify(payload, null, 2);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store'
  });
  res.end(body);
}

async function readJson(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export function createServer({ service, apiKey }) {
  return http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === '/health' && req.method === 'GET') {
        return json(res, 200, { ok: true, service: 'aifp4-mesh', version: '0.1.0' });
      }

      const suppliedKey = req.headers['x-aifp4-api-key'];
      if (apiKey && suppliedKey !== apiKey) return json(res, 401, { error: 'UNAUTHORIZED' });

      if (url.pathname === '/v1/routes' && req.method === 'GET') {
        return json(res, 200, { routes: service.listRoutes({ asset: url.searchParams.get('asset') ?? undefined }) });
      }
      if (url.pathname === '/v1/intents' && req.method === 'POST') {
        return json(res, 201, service.createIntent(await readJson(req)));
      }
      if (url.pathname === '/v1/mesh/reconcile' && req.method === 'POST') {
        return json(res, 200, { reconciled: await service.reconcileQueued() });
      }

      const match = url.pathname.match(/^\/v1\/intents\/([^/]+)(\/execute)?$/);
      if (match && req.method === 'GET' && !match[2]) {
        const intent = service.store.get(match[1]);
        return intent ? json(res, 200, intent) : json(res, 404, { error: 'INTENT_NOT_FOUND' });
      }
      if (match && req.method === 'POST' && match[2] === '/execute') {
        return json(res, 200, await service.execute(match[1]));
      }
      return json(res, 404, { error: 'NOT_FOUND' });
    } catch (error) {
      const status = error?.code?.startsWith?.('INVALID') || error?.name === 'PolicyError' ? 422 : 400;
      return json(res, status, { error: error.code ?? 'BAD_REQUEST', message: error.message, details: error.details ?? undefined });
    }
  });
}
