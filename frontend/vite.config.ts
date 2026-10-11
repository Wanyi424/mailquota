import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

// 一个工程、两个入口：管理端在 /admin/，租户门户在 /tenant/。
// 各自只打包自己用到的页面，公共部分拆成共享块，全部放在 /assets/ 下。
export default defineConfig({
  root: frontendRoot,
  plugins: [react()],
  build: {
    outDir: path.resolve(frontendRoot, '../public'),
    emptyOutDir: true,
    rolldownOptions: {
      input: {
        admin: path.resolve(frontendRoot, 'admin/index.html'),
        tenant: path.resolve(frontendRoot, 'tenant/index.html'),
      },
    },
  },
});
