import { randomUUID } from 'node:crypto';
import { verifySigned } from '../identity.js';
import { VERSION } from '../protocol.js';

const NODE=/^[a-z0-9-]{1,48}$/;
export function signHopAcceptance(identity,hop,message,now=Date.now()) {
  if(hop.nextHop!==identity.nodeId || hop.messageId!==message.messageId || !hop.bundleId || !hop.hopDeliveryId || !hop.bundleHash || !NODE.test(message.sourceNodeId ?? '') || !Number.isFinite(Date.parse(message.expiresAt)) || Date.parse(message.expiresAt)<=now) throw new Error('INVALID_ACCEPTED_HOP');
  const expiresAt=new Date(Math.min(Date.parse(message.expiresAt),now+60000)).toISOString();
  const core={protocolVersion:VERSION,ackId:randomUUID(),bundleId:hop.bundleId,hopDeliveryId:hop.hopDeliveryId,acceptedMessageId:message.messageId,senderNodeId:message.sourceNodeId,receiverNodeId:identity.nodeId,acceptedAt:new Date(now).toISOString(),expiresAt,bundleHash:hop.bundleHash};
  return {...core,signature:identity.sign(core)};
}
export function verifyHopAcceptance(ack,hop,expectedPublicKey,now=Date.now()) {
  if(!ack || typeof ack!=='object' || Array.isArray(ack)) throw new Error('INVALID_HOP_ACCEPTANCE');
  const {signature,...core}=ack;
  if(core.protocolVersion!==VERSION || !/^[0-9a-f-]{36}$/.test(core.ackId ?? '') || !NODE.test(core.senderNodeId ?? '') || !NODE.test(core.receiverNodeId ?? '') || !Number.isFinite(Date.parse(core.acceptedAt)) || !Number.isFinite(Date.parse(core.expiresAt)) || Date.parse(core.acceptedAt)>now+30000 || Date.parse(core.expiresAt)<=now || Date.parse(core.expiresAt)>now+60000 || core.bundleId!==hop.bundleId || core.hopDeliveryId!==hop.hopDeliveryId || core.acceptedMessageId!==hop.messageId || core.receiverNodeId!==hop.nextHop || core.senderNodeId!==hop.senderNodeId || core.bundleHash!==hop.bundleHash) throw new Error('INVALID_HOP_ACCEPTANCE');
  if(!expectedPublicKey || !verifySigned(core,signature,expectedPublicKey)) throw new Error('INVALID_HOP_SIGNATURE');
  return true;
}
