import { randomUUID, createHash } from 'node:crypto';
import { encode, decode } from 'cborg';

export const MAX_ENVELOPE_BYTES = 65536;
export const MAX_FRAGMENTS = 512;
export const hashBytes = bytes => createHash('sha256').update(bytes).digest('hex');
export function encodeFragment(f) {
  return Buffer.from(encode([f.protocolVersion,f.messageId,f.fragmentIndex,f.fragmentCount,Buffer.from(f.originalPayloadHash,'hex'),Buffer.from(f.fragmentHash,'hex'),Date.parse(f.createdAt),Date.parse(f.expiresAt),f.payload]));
}
export function decodeFragment(bytes) {
  if(!(bytes instanceof Uint8Array) || bytes.length>MAX_ENVELOPE_BYTES) throw new Error('INVALID_FRAGMENT_WIRE');
  const value=decode(bytes);
  if(!Array.isArray(value) || value.length!==9 || !(value[4] instanceof Uint8Array) || value[4].length!==32 || !(value[5] instanceof Uint8Array) || value[5].length!==32) throw new Error('INVALID_FRAGMENT_WIRE');
  const [protocolVersion,messageId,fragmentIndex,fragmentCount,original,hash,createdAt,expiresAt,payload]=value;
  return {protocolVersion,messageId,fragmentId:`${messageId}:${fragmentIndex}`,fragmentIndex,fragmentCount,originalPayloadHash:Buffer.from(original).toString('hex'),fragmentHash:Buffer.from(hash).toString('hex'),createdAt:new Date(createdAt).toISOString(),expiresAt:new Date(expiresAt).toISOString(),payload};
}

// MTU is the encoded frame size, including metadata. Nothing here authorizes a payment:
// only the reconstructed, signed AIFP envelope may reach the payment handler.
export function fragmentEnvelope(input, { mtu, expiresAt, messageId = randomUUID(), now = Date.now() }) {
  const bytes = Buffer.from(input);
  if (!Number.isInteger(mtu) || mtu < 256 || mtu > MAX_ENVELOPE_BYTES || !bytes.length || bytes.length > MAX_ENVELOPE_BYTES) throw new Error('INVALID_FRAGMENT_MTU_OR_SIZE');
  if (!Number.isFinite(Date.parse(expiresAt)) || Date.parse(expiresAt) <= now || Date.parse(expiresAt) > now + 86400000) throw new Error('INVALID_FRAGMENT_EXPIRY');
  if (!/^[0-9a-f-]{36}$/.test(messageId)) throw new Error('INVALID_FRAGMENT_ID');
  const originalPayloadHash = hashBytes(bytes), createdAt = new Date(now).toISOString();
  const make = (chunk,index,count) => ({protocolVersion:1,messageId,fragmentId:`${messageId}:${index}`,fragmentIndex:index,fragmentCount:count,originalPayloadHash,fragmentHash:hashBytes(chunk),createdAt,expiresAt,payload:new Uint8Array(chunk)});
  // Conservative sizing accounts for CBOR header growth at the largest index/count.
  const overhead = encodeFragment(make(Buffer.alloc(0),MAX_FRAGMENTS,MAX_FRAGMENTS)).length;
  const chunkSize = mtu - overhead - 8;
  if (chunkSize <= 0 || Math.ceil(bytes.length/chunkSize) > MAX_FRAGMENTS) throw new Error('FRAGMENT_LIMIT');
  const count = Math.ceil(bytes.length/chunkSize);
  const fragments = [];
  for(let index=0;index<count;index++) {
    const fragment = make(bytes.subarray(index*chunkSize,(index+1)*chunkSize),index,count);
    if(encodeFragment(fragment).length > mtu) throw new Error('FRAGMENT_EXCEEDS_MTU');
    fragments.push(fragment);
  }
  return fragments;
}
