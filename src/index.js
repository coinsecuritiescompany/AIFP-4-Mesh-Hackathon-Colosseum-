import { MeshService } from './service.js';
import { createServer } from './server.js';

const port = Number(process.env.PORT ?? 4044);
const apiKey = process.env.AIFP4_API_KEY ?? 'sandbox-demo-key';
const signingSecret = process.env.MESH_HMAC_SECRET ?? 'sandbox-only-change-me';

const routes = [
  {
    id: 'route_mock_usdc', rail: 'mock', network: 'sandbox', asset: 'USDC', online: true,
    feeBps: 10, fixedFeeMinor: 0, latencyMs: 80, supportsOfflineQueue: true,
    minAmountMinor: 1, maxAmountMinor: 1_000_000
  },
  {
    id: 'route_solana_sol', rail: 'solana-devnet', network: 'solana-devnet', asset: 'SOL', online: false,
    feeBps: 0, fixedFeeMinor: 0, latencyMs: 450, supportsOfflineQueue: true,
    minAmountMinor: 1, maxAmountMinor: 1_000_000
  }
];

const service = new MeshService({ routes, signingSecret });
const server = createServer({ service, apiKey });
server.listen(port, '0.0.0.0', () => {
  console.log(`AIFP-4 Mesh sandbox listening on http://127.0.0.1:${port}`);
});
