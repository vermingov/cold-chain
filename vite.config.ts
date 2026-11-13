// Built pages go to dist/; the assets and fonts stay where they are and server.js hands them out from the tree.

import { readFileSync } from 'node:fs';
import { defineConfig } from 'vite';

const { version } = JSON.parse(readFileSync('package.json', 'utf8'));

export default defineConfig({
    define: { __VERSION__: JSON.stringify(version) },
    publicDir: false,
    // No reloading the page when a file changes: the rig's runs take minutes and others edit meanwhile.
    server: { host: '127.0.0.1', port: 8669, hmr: false },
    build: {
        target: 'es2022',
        assetsDir: 'build',
        rollupOptions: { input: ['index.html', 'play.html', 'dev/people.html', 'dev/listen.html'] },
    },
    optimizeDeps: { exclude: ['@babylonjs/havok'] },
});
