// Mode pengembangan: tsc --watch + server statis + salin otomatis public/. Jalankan: npm run dev
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { copyPublic, tscCommand } from './build.mjs';
import { serve } from './serve.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT ?? 5173);

copyPublic();
const { cmd, args, shell } = tscCommand(['-p', 'tsconfig.json', '--watch', '--preserveWatchOutput']);
const tsc = spawn(cmd, args, { cwd: root, stdio: 'inherit', shell });
tsc.on('error', (e) => {
  console.error('Gagal menjalankan TypeScript:', e.message, '\nPastikan sudah "npm install".');
  process.exit(1);
});
tsc.on('exit', (c) => process.exit(c ?? 0));

let t = 0;
fs.watch(path.join(root, 'public'), { recursive: true }, () => {
  clearTimeout(t);
  t = setTimeout(copyPublic, 100);
});

await serve(path.join(root, 'docs'), port);
console.log(`\nDev server: http://localhost:${port}  (muat ulang halaman setelah tsc selesai mengompilasi)\n`);
