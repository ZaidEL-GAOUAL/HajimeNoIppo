import { defineConfig } from 'vite';

export default defineConfig({
    base: './',
    build: {
        target: 'es2022',
        chunkSizeWarningLimit: 6000,
    },
    server: {
        port: 8080,
    },
});
