export class PolicyError extends Error {
  constructor(code, message, details = {}) { super(message); this.name = 'PolicyError'; this.code = code; this.details = details; }
}
export const DEFAULT_POLICY = Object.freeze({
  maxAmountMinor: 1000000, dailyLimitMinor: 5000000, maxTransactions: 100,
  allowedAssets: ['USDC', 'SOL'], allowedRails: ['mock', 'solana-devnet'],
  requirePurpose: true, beneficiaryAllowlist: [], beneficiaryDenylist: [], offlineAllowed: true
});
export function evaluatePolicy(intent, policy = DEFAULT_POLICY, settled = []) {
  const reject = (condition, code, message) => { if (condition) throw new PolicyError(code, message); };
  reject(!Number.isSafeInteger(intent.amountMinor) || intent.amountMinor <= 0, 'INVALID_AMOUNT', 'Amount must be a positive integer');
  reject(intent.amountMinor > policy.maxAmountMinor, 'LIMIT_EXCEEDED', 'Transaction limit exceeded');
  reject(!policy.allowedAssets.includes(intent.asset), 'ASSET_BLOCKED', 'Asset is not allowed');
  reject(policy.requirePurpose && !intent.purpose?.trim(), 'PURPOSE_REQUIRED', 'Purpose is required');
  reject(policy.beneficiaryDenylist?.includes(intent.beneficiary), 'BENEFICIARY_BLOCKED', 'Beneficiary is denied');
  reject(policy.beneficiaryAllowlist?.length && !policy.beneficiaryAllowlist.includes(intent.beneficiary), 'BENEFICIARY_BLOCKED', 'Beneficiary is outside allowlist');
  reject(policy.expiresAt && Date.parse(policy.expiresAt) <= Date.now(), 'POLICY_EXPIRED', 'Policy expired');
  const today = new Date().toISOString().slice(0, 10);
  const usage = settled.filter(x => x.agentId === intent.agentId && x.createdAt?.startsWith(today));
  reject(usage.reduce((n, x) => n + x.amountMinor, 0) + intent.amountMinor > policy.dailyLimitMinor, 'DAILY_LIMIT_EXCEEDED', 'Daily limit exceeded');
  reject(usage.length >= policy.maxTransactions, 'TRANSACTION_COUNT_EXCEEDED', 'Daily transaction count exceeded');
  return { allowed: true, reason: 'Policy approved', policyVersion: policy.version ?? '1', evaluatedRules: ['amount', 'asset', 'purpose', 'beneficiary', 'dailyLimit', 'transactionCount'] };
}
