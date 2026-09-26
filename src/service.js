import { hmacSha256, newId, sha256 } from './canonical.js';
import { chooseRoute } from './mesh-router.js';
import { DEFAULT_POLICY, evaluatePolicy, PolicyError } from './policy.js';
import { IntentStore } from './store.js';
import { MockRailAdapter } from './adapters/mock.js';
import { address } from '@solana/kit';

const HASHED_FIELDS = ['protocol', 'version', 'id', 'idempotencyKey', 'agentId', 'agentPassportId', 'sponsorId', 'beneficiary', 'amountMinor', 'asset', 'purpose', 'createdAt', 'expiresAt', 'policyId', 'nonce'];

export class MeshService {
  constructor({ routes, policy = DEFAULT_POLICY, store = new IntentStore(), signingSecret = '' }) {
    this.routes = routes; this.store = store; this.signingSecret = signingSecret;
    this.adapters = new Map([['mock', new MockRailAdapter()]]); this.inFlight = new Map();
    if (!store.all('agents').length) {
      store.add('policies', { ...policy, id: 'policy_demo', version: '1' });
      store.add('agents', { id: 'agent_demo', name: 'Research Agent', passportId: 'passport_demo', sponsorId: 'sponsor_demo', status: 'active', policyId: 'policy_demo', createdAt: new Date().toISOString() });
    }
  }
  registerAdapter(rail, adapter) { this.adapters.set(rail, adapter); }
  listRoutes({ asset } = {}) { return this.routes.filter(r => !asset || r.asset === asset); }
  setMockOnline(online) { for (const route of this.routes) if (route.rail === 'mock') route.online = online; return this.listRoutes(); }
  createAgent(input = {}) {
    if (typeof input.name !== 'string' || input.name.trim().length < 2 || input.name.length > 80) throw new PolicyError('INVALID_NAME', 'Agent name must be 2–80 characters');
    const policy = this.createPolicy(input.policy ?? {});
    return this.store.add('agents', { id: newId('agent'), name: input.name.trim(), passportId: newId('passport'), sponsorId: 'sponsor_demo', status: 'active', policyId: policy.id, createdAt: new Date().toISOString() });
  }
  createPolicy(input = {}) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PolicyError('INVALID_POLICY', 'Policy must be an object');
    const result = { ...DEFAULT_POLICY, ...input, id: newId('policy'), version: '1' };
    for (const field of ['maxAmountMinor', 'dailyLimitMinor', 'maxTransactions']) if (!Number.isSafeInteger(result[field]) || result[field] <= 0) throw new PolicyError('INVALID_POLICY', `${field} must be positive`);
    for (const field of ['allowedAssets', 'allowedRails', 'beneficiaryAllowlist', 'beneficiaryDenylist']) if (!Array.isArray(result[field]) || result[field].length > 100 || result[field].some(x => typeof x !== 'string' || x.length > 180)) throw new PolicyError('INVALID_POLICY', `${field} must be an array of strings`);
    if (typeof result.offlineAllowed !== 'boolean' || typeof result.requirePurpose !== 'boolean' || (result.expiresAt !== undefined && (typeof result.expiresAt !== 'string' || !Number.isFinite(Date.parse(result.expiresAt))))) throw new PolicyError('INVALID_POLICY', 'Invalid policy flags or expiry');
    return this.store.add('policies', result);
  }
  assignPolicy(agentId, policyId) {
    const agent = this.store.find('agents', agentId), policy = this.store.find('policies', policyId);
    if (!agent || !policy) throw new PolicyError('INVALID_POLICY', 'Agent or policy not found');
    agent.policyId = policy.id; return this.store.saveKind('agents', agent);
  }
  createIntent(input = {}) {
    const prior = this.store.all('intents').find(x => x.idempotencyKey === input.idempotencyKey && input.idempotencyKey);
    if (prior) {
      const fields = ['agentId', 'beneficiary', 'amountMinor', 'asset', 'purpose'];
      if (fields.some(field => prior[field] !== input[field]) || (input.expiresAt !== undefined && prior.expiresAt !== input.expiresAt)) throw new PolicyError('IDEMPOTENCY_CONFLICT', 'This key belongs to a different payment');
      return prior;
    }
    const agent = this.store.find('agents', input.agentId);
    if (!agent || agent.status !== 'active') throw new PolicyError('INVALID_AGENT', 'Select an active agent');
    if (typeof input.idempotencyKey !== 'string' || input.idempotencyKey.length < 3 || input.idempotencyKey.length > 128 || typeof input.beneficiary !== 'string' || !input.beneficiary.trim() || input.beneficiary.length > 180) throw new PolicyError('INVALID_INPUT', 'A unique key and beneficiary are required');
    if (!Number.isSafeInteger(input.amountMinor) || input.amountMinor <= 0) throw new PolicyError('INVALID_AMOUNT', 'Amount must be a positive integer');
    if (typeof input.purpose !== 'string' || input.purpose.length > 180 || typeof input.asset !== 'string') throw new PolicyError('INVALID_INPUT', 'Asset and purpose must be strings');
    if (input.asset === 'SOL') {
      try { address(input.beneficiary); } catch { throw new PolicyError('INVALID_BENEFICIARY', 'Enter a valid Solana Devnet recipient address'); }
    }
    const now = new Date().toISOString();
    const expiresAt = input.expiresAt ?? new Date(Date.now() + 30 * 60000).toISOString();
    if (typeof expiresAt !== 'string' || !Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= Date.now() || Date.parse(expiresAt) > Date.now() + 86400000) throw new PolicyError('INVALID_EXPIRY', 'Expiry must be within 24 hours');
    const policy = this.store.find('policies', agent.policyId);
    const base = { protocol: 'AIFP-4-Mesh', version: '0.2.0', id: newId('pi'), idempotencyKey: input.idempotencyKey, agentId: agent.id, agentPassportId: agent.passportId, sponsorId: agent.sponsorId, beneficiary: input.beneficiary.trim(), amountMinor: input.amountMinor, asset: input.asset, purpose: input.purpose, createdAt: now, expiresAt, policyId: policy.id, nonce: newId('nonce') };
    const policyDecision = evaluatePolicy(base, policy, this.store.all('transactions'));
    const routeDecision = chooseRoute(base, this.routes, policy.allowedRails);
    if (routeDecision.mode === 'queued' && !policy.offlineAllowed) throw new PolicyError('OFFLINE_BLOCKED', 'Policy does not permit offline queueing');
    if (routeDecision.mode === 'unavailable') throw new PolicyError('ROUTE_UNAVAILABLE', 'No eligible route');
    const intentHash = sha256(base);
    const intent = { ...base, intentHash, signature: hmacSha256({ intentHash, agentId: agent.id }, this.signingSecret), policyDecision, routeDecision, state: routeDecision.mode === 'queued' ? 'queued' : 'authorized', receipt: null };
    this.store.add('events', { id: newId('evt'), intentId: intent.id, type: `intent.${intent.state}`, createdAt: now });
    return this.store.create(intent).intent;
  }
  async execute(id) {
    if (this.inFlight.has(id)) return this.inFlight.get(id);
    const task = this.#execute(id); this.inFlight.set(id, task);
    try { return await task; } finally { this.inFlight.delete(id); }
  }
  async #execute(id) {
    const intent = this.store.get(id);
    if (!intent) throw new PolicyError('INTENT_NOT_FOUND', 'Intent not found');
    if (intent.state === 'settled') return intent;
    if (intent.state === 'executing') throw new PolicyError('EXECUTION_UNCERTAIN', 'Execution must be checked manually before retry');
    if (intent.state === 'expired') return intent;
    if (Date.parse(intent.expiresAt) <= Date.now()) { intent.state = 'expired'; return this.store.save(intent); }
    const canonicalPayload = Object.fromEntries(HASHED_FIELDS.map(field => [field, intent[field]]));
    if (sha256(canonicalPayload) !== intent.intentHash || (this.signingSecret && hmacSha256({ intentHash: intent.intentHash, agentId: intent.agentId }, this.signingSecret) !== intent.signature)) throw new PolicyError('INTENT_INTEGRITY_FAILED', 'Stored intent failed its hash or signature check');
    const agent = this.store.find('agents', intent.agentId);
    if (!agent || agent.status !== 'active') throw new PolicyError('INVALID_AGENT', 'Agent is no longer active');
    const policy = this.store.find('policies', agent.policyId);
    const originalPolicy = this.store.find('policies', intent.policyId);
    if (!policy || !originalPolicy) throw new PolicyError('INVALID_POLICY', 'Policy is unavailable');
    // Recheck at settlement: several previously authorized intents may share a daily limit.
    // Reserve executing intents before awaiting a rail, so concurrent requests cannot overspend.
    const reserved = this.store.all('intents').filter(x => x.id !== id && x.agentId === intent.agentId && x.state === 'executing' && x.createdAt.slice(0, 10) === new Date().toISOString().slice(0, 10)).map(x => ({ agentId: x.agentId, amountMinor: x.amountMinor, createdAt: x.createdAt }));
    const usage = [...this.store.all('transactions').filter(x => x.state === 'settled'), ...reserved];
    evaluatePolicy(intent, originalPolicy, usage);
    evaluatePolicy(intent, policy, usage);
    const allowedRails = policy.allowedRails.filter(rail => originalPolicy.allowedRails.includes(rail));
    const routeDecision = chooseRoute(intent, this.routes, allowedRails); intent.routeDecision = routeDecision;
    if (routeDecision.mode !== 'online') {
      if (!policy.offlineAllowed) throw new PolicyError('OFFLINE_BLOCKED', 'Policy does not permit offline queueing');
      intent.state = 'queued'; return this.store.save(intent);
    }
    const adapter = this.adapters.get(routeDecision.route.rail);
    if (!adapter) throw new PolicyError('RAIL_UNAVAILABLE', 'Rail adapter is unavailable');
    intent.state = 'executing'; this.store.save(intent);
    try {
      const execution = await adapter.execute(intent, routeDecision.route);
      const core = { protocol: 'AIFP-4-Mesh', receiptId: newId('rcpt'), intentId: intent.id, intentHash: intent.intentHash, execution, issuedAt: new Date().toISOString() };
      intent.receipt = { ...core, receiptHash: sha256(core), receiptMac: hmacSha256(core, this.signingSecret) };
      intent.state = execution.status === 'settled' ? 'settled' : 'failed';
      this.store.add('receipts', intent.receipt);
      this.store.add('transactions', { id: newId('txn'), intentId: intent.id, agentId: intent.agentId, beneficiary: intent.beneficiary, amountMinor: intent.amountMinor, asset: intent.asset, rail: execution.rail, state: intent.state, reference: execution.reference, createdAt: core.issuedAt });
      return this.store.save(intent);
    } catch (error) {
      intent.failure = 'Execution outcome uncertain; inspect the rail before retrying'; this.store.save(intent); throw error;
    }
  }
  async reconcileQueued() {
    const results = [];
    for (const intent of this.store.queued()) if (Date.parse(intent.expiresAt) <= Date.now()) { intent.state = 'expired'; this.store.save(intent); } else if (chooseRoute(intent, this.routes, this.store.find('policies', intent.policyId).allowedRails).mode === 'online') results.push(await this.execute(intent.id));
    return results;
  }
  stats() { const intents = this.store.all('intents'); return { settledPayments: intents.filter(x => x.state === 'settled').length, queuedPayments: intents.filter(x => x.state === 'queued').length, failedPayments: intents.filter(x => ['failed', 'expired'].includes(x.state)).length, activeAgents: this.store.all('agents').filter(x => x.status === 'active').length, availableRails: this.routes.filter(x => x.online).length, sandboxVolumeMinor: this.store.all('transactions').filter(x => x.state === 'settled' && x.asset === 'USDC').reduce((n, x) => n + x.amountMinor, 0) }; }
}
