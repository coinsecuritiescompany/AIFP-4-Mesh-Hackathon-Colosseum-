import { createHash, createHmac, randomUUID } from 'node:crypto';

export function canonicalize(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalize(value[k])}`).join(',')}}`;
}

export function sha256(value) {
  const input = typeof value === 'string' ? value : canonicalize(value);
  return createHash('sha256').update(input).digest('hex');
}

export function hmacSha256(value, secret) {
  if (!secret) return null;
  const input = typeof value === 'string' ? value : canonicalize(value);
  return createHmac('sha256', secret).update(input).digest('hex');
}

export function newId(prefix) {
  return `${prefix}_${randomUUID().replaceAll('-', '')}`;
}
