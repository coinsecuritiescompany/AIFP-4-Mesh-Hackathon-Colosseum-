const DEMO_KEY = 'sandbox-demo-key';
const DEMO_SECRET = 'sandbox-only-change-me';

export function validateRuntimeSecurity(env) {
  const key = env.AIFP4_API_KEY ?? DEMO_KEY;
  const secret = env.MESH_HMAC_SECRET ?? DEMO_SECRET;
  const exposed = env.AIFP4_BIND_HOST && !['127.0.0.1', 'localhost', '::1'].includes(env.AIFP4_BIND_HOST);
  if (env.SOLANA_PAYER_SECRET_JSON || exposed) {
    if (key === DEMO_KEY || key.startsWith('replace-with-') || key.length < 32 || secret === DEMO_SECRET || secret.startsWith('replace-with-') || secret.length < 32) {
      throw new Error('Devnet or public binding requires unique AIFP4_API_KEY and MESH_HMAC_SECRET (at least 32 characters each)');
    }
  }
  if (env.SOLANA_PAYER_SECRET_JSON) {
    let bytes;
    try { bytes = JSON.parse(env.SOLANA_PAYER_SECRET_JSON); } catch { throw new Error('Invalid Devnet-only payer keypair JSON'); }
    if (!Array.isArray(bytes) || bytes.length !== 64 || bytes.some(x => !Number.isInteger(x) || x < 0 || x > 255)) throw new Error('Devnet payer must be a 64-byte keypair array');
  }
  return { apiKey: key, signingSecret: secret };
}
