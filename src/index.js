import { MeshService } from './service.js';
import { createServer } from './server.js';
import { IntentStore } from './store.js';
import { SolanaDevnetAdapter } from './adapters/solana-devnet.js';
import { validateRuntimeSecurity } from './runtime-security.js';

const port = Number(process.env.PORT ?? 4044);
const { apiKey, signingSecret } = validateRuntimeSecurity({ ...process.env, AIFP4_BIND_HOST: process.env.AIFP4_HTTP_BIND ?? '127.0.0.1' });

const routes = [
  {
    id: 'route_mock_usdc', rail: 'mock', network: 'sandbox', asset: 'USDC', online: true,
    feeBps: 10, fixedFeeMinor: 0, latencyMs: 80, supportsOfflineQueue: true,
    minAmountMinor: 1, maxAmountMinor: 1_000_000
  },
  {
    id: 'route_solana_sol', rail: 'solana-devnet', network: 'solana-devnet', asset: 'SOL', online: Boolean(process.env.SOLANA_PAYER_SECRET_JSON),
    feeBps: 0, fixedFeeMinor: 0, latencyMs: 450, supportsOfflineQueue: true,
    minAmountMinor: 1, maxAmountMinor: 1_000_000
  }
];

const service = new MeshService({ routes, signingSecret, store: new IntentStore(process.env.AIFP4_DATA_FILE ?? '.data/mesh.json') });
if (process.env.SOLANA_PAYER_SECRET_JSON) service.registerAdapter('solana-devnet', new SolanaDevnetAdapter(process.env.SOLANA_PAYER_SECRET_JSON));
const server = createServer({ service, apiKey });
server.listen(port, process.env.AIFP4_HTTP_BIND ?? '127.0.0.1', () => {
  console.log(`AIFP-4 Mesh sandbox listening on http://127.0.0.1:${port}`);
});

function close() { server.close(() => process.exit(0)); server.closeIdleConnections(); }
process.on('SIGINT', close); process.on('SIGTERM', close);
