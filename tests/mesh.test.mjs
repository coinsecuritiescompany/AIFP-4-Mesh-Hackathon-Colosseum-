import test from 'node:test';
import assert from 'node:assert/strict';
import { MeshService } from '../src/service.js';

const routes = [
  { id: 'r1', rail: 'mock', network: 'sandbox', asset: 'USDC', online: true, feeBps: 20, fixedFeeMinor: 0, latencyMs: 10, supportsOfflineQueue: true, minAmountMinor: 1, maxAmountMinor: 1000000 },
  { id: 'r2', rail: 'mock', network: 'sandbox-2', asset: 'USDC', online: true, feeBps: 5, fixedFeeMinor: 0, latencyMs: 30, supportsOfflineQueue: true, minAmountMinor: 1, maxAmountMinor: 1000000 }
];

test('router chooses lowest-cost online route and settles', async () => {
  const service = new MeshService({ routes, signingSecret: 'test-secret' });
  const intent = service.createIntent({ idempotencyKey: 'idem-1', agentId: 'agent_demo', beneficiary: 'merchant_demo', amountMinor: 10000, asset: 'USDC', purpose: 'Dataset access' });
  assert.equal(intent.routeDecision.route.id, 'r2');
  const settled = await service.execute(intent.id);
  assert.equal(settled.state, 'settled');
  assert.equal(settled.receipt.intentHash, intent.intentHash);
});

test('idempotency returns the same intent', () => {
  const service = new MeshService({ routes, signingSecret: 'test-secret' });
  const input = { idempotencyKey: 'idem-stable', agentId: 'agent_demo', beneficiary: 'merchant_demo', amountMinor: 100, asset: 'USDC', purpose: 'Request' };
  assert.equal(service.createIntent(input).id, service.createIntent(input).id);
});

test('offline route queues intent', () => {
  const offline = routes.map((r) => ({ ...r, online: false }));
  const service = new MeshService({ routes: offline, signingSecret: 'test-secret' });
  const intent = service.createIntent({ idempotencyKey: 'idem-offline', agentId: 'agent_demo', beneficiary: 'merchant_demo', amountMinor: 100, asset: 'USDC', purpose: 'Offline purchase' });
  assert.equal(intent.state, 'queued');
});
