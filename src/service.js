import { hmacSha256, newId, sha256 } from './canonical.js';
import { chooseRoute } from './mesh-router.js';
import { DEFAULT_POLICY, evaluatePolicy } from './policy.js';
import { IntentStore } from './store.js';
import { MockRailAdapter } from './adapters/mock.js';

export class MeshService {
  constructor({ routes, policy = DEFAULT_POLICY, store = new IntentStore(), signingSecret = '' }) {
    this.routes = routes;
    this.policy = policy;
    this.store = store;
    this.signingSecret = signingSecret;
    this.adapters = new Map([['mock', new MockRailAdapter()]]);
  }

  registerAdapter(rail, adapter) { this.adapters.set(rail, adapter); }

  listRoutes({ asset } = {}) {
    return this.routes.filter((r) => !asset || r.asset === asset);
  }

  createIntent(input) {
    const now = new Date().toISOString();
    const base = {
      protocol: 'AIFP-4-Mesh',
      version: '0.1.0',
      id: newId('pi'),
      idempotencyKey: input.idempotencyKey,
      agentId: input.agentId,
      beneficiary: input.beneficiary,
      amountMinor: input.amountMinor,
      asset: input.asset,
      purpose: input.purpose,
      createdAt: now,
      expiresAt: input.expiresAt ?? new Date(Date.now() + 10 * 60_000).toISOString()
    };
    if (!base.idempotencyKey || !base.agentId || !base.beneficiary || !base.asset) {
      throw new Error('idempotencyKey, agentId, beneficiary, asset are required');
    }

    const policyDecision = evaluatePolicy(base, this.policy);
    const routeDecision = chooseRoute(base, this.routes, this.policy.allowedRails);
    const intentHash = sha256(base);
    const signature = hmacSha256({ intentHash, agentId: base.agentId }, this.signingSecret);
    const intent = {
      ...base,
      intentHash,
      signature,
      policyDecision,
      routeDecision,
      state: routeDecision.mode === 'queued' ? 'queued' : routeDecision.mode === 'online' ? 'authorized' : 'blocked',
      receipt: null
    };
    return this.store.create(intent).intent;
  }

  async execute(id) {
    const intent = this.store.get(id);
    if (!intent) throw new Error('INTENT_NOT_FOUND');
    if (intent.state === 'settled') return intent;
    if (new Date(intent.expiresAt).getTime() <= Date.now()) {
      intent.state = 'expired';
      return this.store.save(intent);
    }
    const route = intent.routeDecision?.route;
    if (!route || !route.online) {
      intent.state = 'queued';
      return this.store.save(intent);
    }
    const adapter = this.adapters.get(route.rail);
    if (!adapter) throw new Error(`NO_ADAPTER:${route.rail}`);

    intent.state = 'executing';
    this.store.save(intent);
    const execution = await adapter.execute(intent, route);
    const receiptCore = {
      protocol: 'AIFP-4-Mesh',
      receiptId: newId('rcpt'),
      intentId: intent.id,
      intentHash: intent.intentHash,
      execution,
      issuedAt: new Date().toISOString()
    };
    intent.receipt = {
      ...receiptCore,
      receiptMac: hmacSha256(receiptCore, this.signingSecret)
    };
    intent.state = execution.status === 'settled' ? 'settled' : execution.status;
    return this.store.save(intent);
  }

  async reconcileQueued() {
    const results = [];
    for (const intent of this.store.queued()) {
      const refreshed = chooseRoute(intent, this.routes, this.policy.allowedRails);
      intent.routeDecision = refreshed;
      if (refreshed.mode === 'online') results.push(await this.execute(intent.id));
    }
    return results;
  }
}
