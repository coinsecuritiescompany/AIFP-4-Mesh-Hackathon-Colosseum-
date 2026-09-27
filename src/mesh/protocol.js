import { randomUUID } from 'node:crypto';
import { encode, decode } from 'cborg';
import { sha256 } from '../canonical.js';
import { verifySigned } from './identity.js';

export const VERSION = '/aifp4/mesh/1.0.0';
export const TYPES = new Set(['PEER_HELLO','PEER_CAPABILITIES','LINK_STATE','ROUTE_ADVERTISEMENT','ROUTE_WITHDRAWAL','PAYMENT_INTENT','PAYMENT_FORWARD','PAYMENT_ACK','PAYMENT_RECEIPT','PAYMENT_FAILED','PING','PONG','RECONCILE_REQUEST','RECONCILE_RESPONSE','TRANSPORT_UP','TRANSPORT_DOWN']);
export function envelope(identity, type, payload, fields = {}) {
  if (!TYPES.has(type)) throw new Error('Unknown message type');
  const body = { protocolVersion: VERSION, messageId: randomUUID(), messageType: type, sourceNodeId: identity.nodeId, originNodeId: fields.originNodeId ?? identity.nodeId, destinationNodeId: fields.destinationNodeId ?? '', createdAt: new Date().toISOString(), expiresAt: fields.expiresAt ?? new Date(Date.now() + 60000).toISOString(), hopCount: fields.hopCount ?? 0, maxHops: fields.maxHops ?? 8, previousHop: fields.previousHop ?? '', payloadType: 'application/aifp4+cbor', payloadHash: sha256(payload), payload, publicKey: identity.publicKey };
  return { ...body, signature: identity.sign(body) };
}
export function validateEnvelope(message, knownKey, now = Date.now()) {
  if (!message || typeof message !== 'object' || Array.isArray(message)) throw new Error('INVALID_ENVELOPE');
  const { signature, ...body } = message;
  if (body.protocolVersion !== VERSION || !TYPES.has(body.messageType) || typeof body.messageId !== 'string' || !/^[0-9a-f-]{36}$/.test(body.messageId) || typeof body.sourceNodeId !== 'string' || !/^[a-z0-9-]{1,48}$/.test(body.sourceNodeId) || typeof body.originNodeId !== 'string' || !Number.isInteger(body.hopCount) || !Number.isInteger(body.maxHops) || body.hopCount < 0 || body.maxHops > 16 || body.hopCount > body.maxHops) throw new Error('INVALID_ENVELOPE');
  if (!Number.isFinite(Date.parse(body.createdAt)) || !Number.isFinite(Date.parse(body.expiresAt)) || Date.parse(body.createdAt) > now + 30000 || Date.parse(body.expiresAt) <= now || Date.parse(body.expiresAt) > now + 86400000 || body.payloadHash !== sha256(body.payload)) throw new Error('EXPIRED_OR_TAMPERED');
  if (knownKey && knownKey !== body.publicKey) throw new Error('PEER_KEY_CHANGED');
  if (!verifySigned(body, signature, body.publicKey)) throw new Error('INVALID_SIGNATURE');
  return message;
}
export function wireEncode(value) { return Buffer.from(encode(value)); }
export function wireDecode(bytes) { if (bytes.length > 65536) throw new Error('WIRE_TOO_LARGE'); return decode(bytes); }
