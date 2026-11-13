// A headless browser to look at the game with.
//
// Drives Chromium over the DevTools protocol with nothing but Node's own
// WebSocket and fetch, so it needs no npm install. It is how every change to
// this game is checked: boot it, reach into `window.__six`, force whatever is
// being looked at, and read back screenshots, console errors and failed
// requests.
//
//     import { open } from './rig.mjs';
//     const rig = await open('http://127.0.0.1:8667/');
//     await rig.eval('window.__six.director.fire("visitor")');
//     await rig.shot('visitor.png');
//     await rig.close();
//
// Audio is muted at the browser. The game plays screams; the machine this runs
// on may have someone sitting at it.

import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROMIUM = process.env.CHROMIUM || '/usr/bin/chromium';

// Swiftshader renders the same pixels as a GPU, slowly, and it is the only
// backend that is guaranteed to exist on a headless box. `RIG_GPU=1` asks for
// the real one, for measuring frame times rather than looking at frames.
function gpuFlags() {
    if (process.env.RIG_GPU) {
        return ['--use-angle=vulkan', '--enable-features=Vulkan', '--ignore-gpu-blocklist', '--enable-unsafe-webgpu',
            ...(process.env.RIG_UNCAP ? ['--disable-gpu-vsync', '--disable-frame-rate-limit'] : [])];
    }
    return ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'];
}

async function waitForEndpoint(port, tries = 80) {
    for (let i = 0; i < tries; i++) {
        try {
            const res = await fetch(`http://127.0.0.1:${port}/json/version`);
            if (res.ok) return await res.json();
        } catch { /* not up yet */ }
        await new Promise((r) => setTimeout(r, 100));
    }
    throw new Error('chromium never opened its debugging port');
}

export async function open(url, { width = 1280, height = 720, port = 9333 + Math.floor(Math.random() * 400) } = {}) {
    const profile = mkdtempSync(join(tmpdir(), 'six-rig-'));
    const proc = spawn(CHROMIUM, [
        '--headless=new',
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${profile}`,
        `--window-size=${width},${height}`,
        '--mute-audio',
        '--autoplay-policy=no-user-gesture-required',
        '--no-first-run', '--no-default-browser-check',
        // Chromium will not run its sandbox as root (a container).
        ...(process.getuid?.() === 0 ? ['--no-sandbox'] : []),
        '--disable-background-timer-throttling',
        '--disable-renderer-backgrounding',
        '--disable-backgrounding-occluded-windows',
        ...gpuFlags(),
        'about:blank',
    ], { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr.on('data', (d) => { stderr += d; });
    // The browser goes with this process however it ends: a `finally` does not run when node is killed by a signal
    // (`timeout`, a stopped task), and each browser left behind holds a gigabyte or two.
    process.on('exit', () => proc.kill('SIGKILL'));
    for (const signal of ['SIGTERM', 'SIGINT', 'SIGHUP']) process.once(signal, () => { proc.kill('SIGKILL'); process.exit(128); });

    await waitForEndpoint(port);
    const target = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
    const ws = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, no) => { ws.onopen = ok; ws.onerror = no; });

    let seq = 0;
    const pending = new Map();
    const log = [];
    const failures = [];
    const heard = new Map();        // a protocol event's name -> what is done with it (`rig.on`)

    ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && pending.has(msg.id)) {
            const { ok, no } = pending.get(msg.id);
            pending.delete(msg.id);
            if (msg.error) no(new Error(msg.error.message)); else ok(msg.result);
            return;
        }
        if (heard.has(msg.method)) heard.get(msg.method)(msg.params);
        if (msg.method === 'Runtime.consoleAPICalled') {
            const text = msg.params.args.map((a) => a.value ?? a.description ?? '').join(' ');
            log.push({ level: msg.params.type, text });
        } else if (msg.method === 'Runtime.exceptionThrown') {
            const d = msg.params.exceptionDetails;
            log.push({ level: 'exception', text: (d.exception && d.exception.description) || d.text });
        } else if (msg.method === 'Network.loadingFailed') {
            failures.push(msg.params.errorText + ' ' + (msg.params.requestId || ''));
        } else if (msg.method === 'Network.responseReceived') {
            const r = msg.params.response;
            if (r.status >= 400) failures.push(`${r.status} ${r.url}`);
        }
    };

    const send = (method, params = {}) => new Promise((ok, no) => {
        const id = ++seq;
        pending.set(id, { ok, no });
        ws.send(JSON.stringify({ id, method, params }));
    });

    await send('Runtime.enable');
    await send('Network.enable');
    await send('Page.enable');
    await send('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
    await send('Page.navigate', { url });

    const rig = {
        log, failures, send,
        on(method, handler) { heard.set(method, handler); },

        async eval(expr) {
            const r = await send('Runtime.evaluate', {
                expression: expr, awaitPromise: true, returnByValue: true,
            });
            if (r.exceptionDetails) {
                const d = r.exceptionDetails;
                throw new Error('eval: ' + ((d.exception && d.exception.description) || d.text));
            }
            return r.result.value;
        },

        // Resolves once `expr` is truthy in the page.
        async until(expr, timeout = 30000) {
            const end = Date.now() + timeout;
            while (Date.now() < end) {
                try { if (await rig.eval(expr)) return true; } catch { /* page not ready */ }
                await new Promise((r) => setTimeout(r, 100));
            }
            throw new Error('timed out waiting for: ' + expr);
        },

        wait(ms) { return new Promise((r) => setTimeout(r, ms)); },

        async shot(path) {
            const r = await send('Page.captureScreenshot', { format: 'png' });
            writeFileSync(path, Buffer.from(r.data, 'base64'));
            return path;
        },

        async click(x = width / 2, y = height / 2) {
            for (const type of ['mousePressed', 'mouseReleased']) {
                await send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount: 1 });
            }
        },

        async move(x, y) {
            await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y });
        },

        // The mouse pressed at the first point, drawn through the rest with
        // the button held, and let go at the last: as a hand would, taking
        // `seconds` over it.
        async drag(points, seconds = 1) {
            const steps = Math.max(2, Math.round(seconds * 60));
            const held = { button: 'left', buttons: 1 };
            await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: points[0][0], y: points[0][1] });
            await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: points[0][0], y: points[0][1], clickCount: 1, ...held });
            for (let i = 1; i <= steps; i++) {
                const along = (i / steps) * (points.length - 1), leg = Math.min(points.length - 2, Math.floor(along)), t = along - leg;
                const x = points[leg][0] + (points[leg + 1][0] - points[leg][0]) * t, y = points[leg][1] + (points[leg + 1][1] - points[leg][1]) * t;
                await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, ...held });
                await new Promise((r) => setTimeout(r, 1000 / 60));
            }
            const last = points[points.length - 1];
            await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: last[0], y: last[1], clickCount: 1, button: 'left' });
        },

        async key(code, down = true) {
            await send('Input.dispatchKeyEvent', {
                type: down ? 'rawKeyDown' : 'keyUp', code, key: code.replace(/^Key/, '').toLowerCase(),
            });
        },

        // Text into whatever has focus, as typing would put it there.
        async type(text) {
            await send('Input.insertText', { text });
        },

        // Click the middle of whatever `selector` matches, as a real click.
        async press(selector) {
            const at = await rig.eval(`(() => { const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
                return [r.left + r.width / 2, r.top + r.height / 2]; })()`);
            await rig.click(at[0], at[1]);
        },

        // From a cold page to the title: the click that lets sound play, a
        // second one to skip the film, and the wait for the level behind the
        // menu. `play` goes on through Descend into the descent itself.
        async begin({ play = true, film = false } = {}) {
            await rig.until('document.querySelector("#gate.shown")', 30000);
            await rig.click();
            if (!film) { await rig.wait(900); await rig.click(); }
            await rig.until('window.__six && window.__six.game.state === window.__six.STATE.TITLE', 120000);
            if (!play) return;
            // The menu fades in; a press during the fade can land on nothing.
            await rig.until('getComputedStyle(document.querySelector("#menu")).opacity === "1"', 10000);
            await rig.press('[data-act=descend]');
            await rig.until('window.__six.game.state === window.__six.STATE.PLAY', 20000);
        },

        errors() {
            return log.filter((l) => l.level === 'error' || l.level === 'exception');
        },

        async close() {
            try { ws.close(); } catch { /* already gone */ }
            proc.kill('SIGTERM');
            await new Promise((r) => setTimeout(r, 200));
            rmSync(profile, { recursive: true, force: true });
            if (process.env.RIG_DEBUG) process.stderr.write(stderr);
        },
    };
    return rig;
}
