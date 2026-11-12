// Static file server for SIX SIX S1X...
//
// No dependencies on purpose: this only has to hand four kinds of file to one
// browser. Range requests are honoured because audio elements ask for them
// even when fetch() would not.
//
// Text is gzipped on the way out. The engine alone is 8.4MB uncompressed and
// it dominates the load over any link that is not a local network — through a
// tunnel at about a megabyte a second it was seven and a half seconds on its
// own. Images and audio are skipped: they are already compressed and running
// them through gzip costs CPU to make them very slightly larger.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFile } from 'node:child_process';

const ROOT = import.meta.dirname;
const DIST = path.join(ROOT, 'dist');
const PORT = Number(process.env.PORT || 8666);
const HOST = process.env.HOST || '127.0.0.1';

// Worth gzipping: everything here is text and compresses to a quarter or less.
const COMPRESS = new Set(['.html', '.js', '.mjs', '.css', '.json']);

const TYPES = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.mjs': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.ogg': 'audio/ogg',
    '.flac': 'audio/flac',
    '.mp3': 'audio/mpeg',
    '.json': 'application/json; charset=utf-8',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
    '.glb': 'model/gltf-binary',
    '.wasm': 'application/wasm',
    '.woff2': 'font/woff2',
};

function resolve(urlPath) {
    const clean = decodeURIComponent(urlPath.split('?')[0]);
    const rel = path.normalize(clean === '/' ? '/index.html' : clean).replace(/^(\.\.[/\\])+/, '');
    // The built pages and their code are in dist/ (npm run build); the assets they load are in the tree.
    const built = path.join(DIST, rel), full = path.join(ROOT, rel);
    if (built.startsWith(DIST) && fs.existsSync(built)) return built;
    return full.startsWith(ROOT) ? full : null;
}

// The one file that can be written: what was thought of each recording on
// dev/listen.html. It has to be JSON and it has to be small. Whenever it
// changes, the game's sounds are made again from it (tools/sounds.py), so
// what was passed is in the game at the next reload.
const VERDICTS = { url: '/dev/verdicts.json', most: 256 * 1024 };
const REMAKE = ['python3', 'tools/sounds.py', 'assets/audition', 'dev/verdicts.json', 'assets/sounds'];

function keepVerdicts(req, res) {
    const parts = [];
    let size = 0;
    req.on('data', (part) => {
        size += part.length;
        if (size > VERDICTS.most) req.destroy();
        else parts.push(part);
    });
    req.on('end', () => {
        const text = Buffer.concat(parts).toString('utf8');
        try {
            JSON.parse(text);
        } catch {
            res.writeHead(400).end('not json');
            return;
        }
        fs.writeFile(path.join(ROOT, VERDICTS.url), text, (err) => {
            res.writeHead(err ? 500 : 204).end();
            if (!err) execFile(REMAKE[0], REMAKE.slice(1), { cwd: ROOT }, (failed) => failed && console.error('sounds not remade:', failed.message));
        });
    });
}

const server = http.createServer((req, res) => {
    if (req.method === 'PUT' && req.url === VERDICTS.url) {
        keepVerdicts(req, res);
        return;
    }
    const file = resolve(req.url);
    if (!file) {
        res.writeHead(403).end('forbidden');
        return;
    }

    fs.stat(file, (err, stat) => {
        if (err || !stat.isFile()) {
            res.writeHead(404, { 'content-type': 'text/plain' }).end('404');
            return;
        }

        const type = TYPES[path.extname(file).toLowerCase()] || 'application/octet-stream';
        const range = req.headers.range;

        if (range) {
            const m = /bytes=(\d*)-(\d*)/.exec(range);
            const start = m && m[1] ? parseInt(m[1], 10) : 0;
            const end = m && m[2] ? parseInt(m[2], 10) : stat.size - 1;
            if (start >= stat.size || end >= stat.size || start > end) {
                res.writeHead(416, { 'content-range': `bytes */${stat.size}` }).end();
                return;
            }
            res.writeHead(206, {
                'content-type': type,
                'content-length': end - start + 1,
                'content-range': `bytes ${start}-${end}/${stat.size}`,
                'accept-ranges': 'bytes',
                'cache-control': 'no-cache',
            });
            fs.createReadStream(file, { start, end }).pipe(res);
            return;
        }

        const ext = path.extname(file).toLowerCase();
        const wantsGzip = /\bgzip\b/.test(req.headers['accept-encoding'] || '');

        if (wantsGzip && COMPRESS.has(ext)) {
            res.writeHead(200, {
                'content-type': type,
                'content-encoding': 'gzip',
                'vary': 'accept-encoding',
                'cache-control': 'no-cache',
            });
            fs.createReadStream(file).pipe(zlib.createGzip({ level: 6 })).pipe(res);
            return;
        }

        res.writeHead(200, {
            'content-type': type,
            'content-length': stat.size,
            'accept-ranges': 'bytes',
            'cache-control': 'no-cache',
        });
        fs.createReadStream(file).pipe(res);
    });
});

server.listen(PORT, HOST, () => {
    console.log(`six six s1x serving ${ROOT} on http://${HOST}:${PORT}`);
});
