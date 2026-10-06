import fs from 'node:fs';
import path from 'node:path';
import { loadEnvFile } from 'node:process';
import { projectRoot } from './local-network.mjs';
// Preserve caller-supplied variables; load generated credentials for CLI proofs.
const file=path.join(projectRoot,'.env');
if(fs.existsSync(file)) loadEnvFile(file);
