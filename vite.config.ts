import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
export default defineConfig({plugins:[react()],build:{outDir:'dist',sourcemap:false,rollupOptions:{output:{manualChunks(id){if(/node_modules[/\\](react|react-dom|scheduler|@radix-ui)[/\\]/.test(id))return 'ui-vendor';}}}},server:{host:'127.0.0.1'}});
