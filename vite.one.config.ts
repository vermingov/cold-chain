import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
export default defineConfig({
    base: './', define: { __VERSION__: JSON.stringify(version) }, publicDir: false,
    build: { target: 'es2022', assetsDir: 'build', outDir: 'one', chunkSizeWarningLimit: 100000,
        rolldownOptions: { input: ['play.html'], output: { codeSplitting: false } } },
    optimizeDeps: { exclude: ['@babylonjs/havok'] },
});
