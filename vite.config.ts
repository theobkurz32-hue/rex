import { defineConfig } from 'vite';
export default defineConfig({ base: './', worker: { format: 'es' }, build: { target: ['es2020','safari15'], chunkSizeWarningLimit: 1600 }, server: { host: '127.0.0.1' } });
