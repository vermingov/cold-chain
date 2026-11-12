// Built pages go to dist/; the assets and fonts stay where they are and server.js hands them out from the tree.

import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

export default defineConfig({
    define: { __VERSION__: JSON.stringify(version) },
    publicDir: false,
    server: { host: '127.0.0.1', port: 8669 },
    build: {
        target: 'es2022',
        assetsDir: 'build',
        rollupOptions: { input: ['index.html', 'play.html', 'dev/yard.html', 'dev/table.html', 'dev/people.html', 'dev/listen.html'] },
    },
    optimizeDeps: { exclude: ['@babylonjs/havok'] },
});
