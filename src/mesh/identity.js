import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPairSync, createPrivateKey, createPublicKey, sign, verify } from 'node:crypto';
import { canonicalize } from '../canonical.js';

export function loadIdentity(file, nodeId) {
  fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
  if (!fs.existsSync(file)) {
    const pair = generateKeyPairSync('ed25519');
    const record = { nodeId, privateKey: pair.privateKey.export({ format: 'pem', type: 'pkcs8' }), publicKey: pair.publicKey.export({ format: 'pem', type: 'spki' }) };
    fs.writeFileSync(file, JSON.stringify(record), { mode: 0o600, flag: 'wx' });
  }
  const record = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (record.nodeId !== nodeId) throw new Error('Node identity mismatch');
  fs.chmodSync(file, 0o600);
  const privateKey = createPrivateKey(record.privateKey);
  const publicKey = createPublicKey(record.publicKey);
  if (publicKey.export({ format: 'pem', type: 'spki' }) !== createPublicKey(privateKey).export({ format: 'pem', type: 'spki' })) throw new Error('Invalid stored keypair');
  return { nodeId, publicKey: record.publicKey, sign: value => sign(null, Buffer.from(canonicalize(value)), privateKey).toString('base64') };
}
export function verifySigned(value, signature, publicKey) {
  try { return typeof signature === 'string' && verify(null, Buffer.from(canonicalize(value)), createPublicKey(publicKey), Buffer.from(signature, 'base64')); } catch { return false; }
}
