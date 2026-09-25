import { newId, sha256 } from '../canonical.js';

export class MockRailAdapter {
  constructor({ rail = 'mock', network = 'sandbox' } = {}) {
    this.rail = rail;
    this.network = network;
  }

  async execute(intent, route) {
    const executionId = newId('exec');
    return {
      executionId,
      rail: this.rail,
      network: this.network,
      status: 'settled',
      reference: `sandbox:${sha256(`${intent.intentHash}:${executionId}`).slice(0, 32)}`,
      amountMinor: intent.amountMinor,
      asset: intent.asset,
      beneficiary: intent.beneficiary,
      feeMinor: route.estimatedFeeMinor,
      settledAt: new Date().toISOString()
    };
  }
}
