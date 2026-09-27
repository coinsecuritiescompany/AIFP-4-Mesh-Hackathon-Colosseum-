import test from 'node:test';

// Readiness markers, not substitute transport tests. Each needs two endpoints,
// a real adapter and a settlement/receipt assertion before it may pass.
for(const [name,requirement] of [
  ['Bluetooth BLE','two BLE devices and a working GATT adapter'],
  ['Bluetooth Mesh','provisioned Mesh relays and physical gateways'],
  ['LoRa RF','two permitted radio modems and regional configuration'],
  ['packet radio','two supported physical modems'],
  ['non-IP satellite','provider account, modem and gateway'],
  ['5G ProSe','sidelink-capable UE, modem API and network configuration']
]) test(name,{skip:`BLOCKED_BY_EXTERNAL_DEPENDENCY: ${requirement}`},()=>{});
