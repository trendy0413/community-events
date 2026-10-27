import path from 'node:path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig, searchForWorkspaceRoot } from 'vite';

// In development the API runs on its own port (`npm run dev` in the repo
// root). On the demo host both share one origin, so the client always calls
// relative /v1 paths and needs no CORS setup and no API URL in the bundle.
const API = 'http://127.0.0.1:3000';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  server: {
    // IPv4 loopback: on some Windows setups "localhost" binds to ::1 only.
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/v1': API, '/docs': API, '/openapi.json': API },
    // The demo people come from the repo's seed file, outside this folder.
    fs: { allow: [searchForWorkspaceRoot(process.cwd()), path.resolve(import.meta.dirname, '../seed')] },
  },
});
