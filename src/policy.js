export class PolicyError extends Error {
  constructor(code, message, details = {}) {
    super(message);
    this.name = 'PolicyError';
    this.code = code;
    this.details = details;
  }
}

export const DEFAULT_POLICY = Object.freeze({
  maxAmountMinor: 1_000_000,
  allowedAssets: ['USDC', 'SOL', 'USD'],
  allowedRails: ['mock', 'solana-devnet'],
  requirePurpose: true,
  beneficiaryAllowlist: []
});

export function evaluatePolicy(intent, policy = DEFAULT_POLICY) {
  if (!Number.isSafeInteger(intent.amountMinor) || intent.amountMinor <= 0) {
    throw new PolicyError('INVALID_AMOUNT', 'amountMinor must be a positive safe integer');
  }
  if (intent.amountMinor > policy.maxAmountMinor) {
    throw new PolicyError('LIMIT_EXCEEDED', 'Payment exceeds delegated spending limit', {
      maxAmountMinor: policy.maxAmountMinor
    });
  }
  if (!policy.allowedAssets.includes(intent.asset)) {
    throw new PolicyError('ASSET_BLOCKED', `Asset ${intent.asset} is not allowed`);
  }
  if (policy.requirePurpose && !intent.purpose?.trim()) {
    throw new PolicyError('PURPOSE_REQUIRED', 'purpose is required by policy');
  }
  if (policy.beneficiaryAllowlist.length > 0 && !policy.beneficiaryAllowlist.includes(intent.beneficiary)) {
    throw new PolicyError('BENEFICIARY_BLOCKED', 'Beneficiary is outside the allowlist');
  }
  return { allowed: true, policyVersion: 'sandbox-1' };
}
