import fs from 'node:fs';
import { randomBytes } from 'node:crypto';
import { projectRoot } from './local-network.mjs';
import path from 'node:path';
const file=path.join(projectRoot,'.env');
if(fs.existsSync(file)) console.log('.env already exists; credentials preserved.');
else {
  fs.writeFileSync(file,`AIFP4_PORT=4044\nAIFP4_BIND_HOST=127.0.0.1\nAIFP4_API_KEY=${randomBytes(32).toString('hex')}\nMESH_HMAC_SECRET=${randomBytes(32).toString('hex')}\nSOLANA_PAYER_SECRET_JSON=\n`,{flag:'wx',mode:0o600});
  console.log('Created local demo credentials in .env.');
}
