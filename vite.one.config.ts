// The GitHub Pages build: one bundle (no code splitting), relative paths, into one/. The site is one/play.html and
// one/build/ with the tree's assets/ next to them and an index.html that sends to play.html (the gh-pages branch).
import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';
const { version } = JSON.parse(readFileSync('package.json', 'utf8'));
export default defineConfig({
    base: './', define: { __VERSION__: JSON.stringify(version) }, publicDir: false,
    build: { target: 'es2022', assetsDir: 'build', outDir: 'one', chunkSizeWarningLimit: 100000,
        rolldownOptions: { input: ['play.html'], output: { codeSplitting: false } } },
    optimizeDeps: { exclude: ['@babylonjs/havok'] },
});
