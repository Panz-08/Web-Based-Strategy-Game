// Menjalankan TypeScript lewat node: node scripts/tsc.mjs --noEmit
import { spawnSync } from 'node:child_process';
import { tscCommand } from './build.mjs';

const { cmd, args, shell } = tscCommand(process.argv.slice(2));
const r = spawnSync(cmd, args, { stdio: 'inherit', shell });
process.exit(r.status ?? 1);
