import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { versionFile } from './vite-version.js';

export default defineConfig({
  plugins: [react(), versionFile()],
  server: { port: 3100, strictPort: true },
});
