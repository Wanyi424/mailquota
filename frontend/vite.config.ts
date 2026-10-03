import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  root: frontendRoot,
  base: '/admin/assets/',
  plugins: [react()],
  build: {
    outDir: path.resolve(frontendRoot, '../public/admin'),
    emptyOutDir: true,
  },
});
