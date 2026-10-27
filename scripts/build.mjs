// Build produksi: kompilasi TypeScript -> ES modules (dist/js) + salin aset statis (public -> dist).
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dist = path.join(root, 'dist');

export function copyPublic() {
  fs.mkdirSync(dist, { recursive: true });
  fs.cpSync(path.join(root, 'public'), dist, { recursive: true });
  fs.writeFileSync(path.join(dist, '.nojekyll'), ''); // GitHub Pages: jangan proses dengan Jekyll
}

/**
 * Perintah untuk menjalankan TypeScript. Dijalankan lewat `node` (bukan .bin/tsc) agar tetap bekerja di drive
 * yang di-mount dengan opsi noexec (EACCES), mis. partisi NTFS/exFAT atau /mnt/data.
 */
export function tscCommand(args) {
  const lib = path.join(root, 'node_modules', 'typescript', 'lib');
  // Utamakan compiler asli (_tsc.js): shim tsc.js pada TypeScript terbaru me-restart proses lewat execve,
  // yang ditolak pada sebagian sistem (EACCES).
  for (const f of ['_tsc.js', 'tsc.js']) {
    const p = path.join(lib, f);
    if (fs.existsSync(p)) return { cmd: process.execPath, args: [p, ...args], shell: false };
  }
  return { cmd: 'tsc', args, shell: true }; // fallback: tsc global
}

export function build() {
  fs.rmSync(dist, { recursive: true, force: true });
  const { cmd, args, shell } = tscCommand(['-p', 'tsconfig.json']);
  const r = spawnSync(cmd, args, { cwd: root, stdio: 'inherit', shell });
  if (r.status !== 0) {
    console.error('\nKompilasi gagal. Sudah menjalankan "npm install"? (butuh typescript)');
    process.exit(r.status ?? 1);
  }
  copyPublic();
  console.log('Build selesai -> dist/');
}

if (process.argv[1] === fileURLToPath(import.meta.url)) build();
