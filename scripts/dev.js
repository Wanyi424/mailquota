import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const viteBin = resolve(root, 'node_modules/vite/bin/vite.js');

const frontend = spawn(process.execPath, [viteBin, 'build', '--watch', '--config', 'frontend/vite.config.ts'], {
  cwd: root,
  stdio: 'inherit',
});

const backend = spawn(process.execPath, ['--env-file-if-exists=.env', '--watch', 'src/server.js'], {
  cwd: root,
  stdio: 'inherit',
});

const cleanup = (code = 0) => {
  try { frontend.kill(); } catch {}
  try { backend.kill(); } catch {}
  process.exit(code);
};

process.on('SIGINT', () => cleanup(0));
process.on('SIGTERM', () => cleanup(0));

frontend.on('exit', (code) => {
  if (code !== null && code !== 0) cleanup(code);
});
backend.on('exit', (code) => {
  if (code !== null && code !== 0) cleanup(code);
});
