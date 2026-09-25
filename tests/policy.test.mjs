import test from 'node:test';
import assert from 'node:assert/strict';
import { evaluatePolicy, DEFAULT_POLICY, PolicyError } from '../src/policy.js';

test('policy accepts a valid delegated payment', () => {
  const result = evaluatePolicy({ amountMinor: 500, asset: 'USDC', purpose: 'API usage', beneficiary: 'merchant_1' }, DEFAULT_POLICY);
  assert.equal(result.allowed, true);
});

test('policy rejects payments over the delegated limit', () => {
  assert.throws(
    () => evaluatePolicy({ amountMinor: 1_000_001, asset: 'USDC', purpose: 'API usage', beneficiary: 'merchant_1' }, DEFAULT_POLICY),
    (error) => error instanceof PolicyError && error.code === 'LIMIT_EXCEEDED'
  );
});
