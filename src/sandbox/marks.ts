// What a wound looks like from outside: painted into a sheet laid over the
// person's own skin and clothes in their texture space (Babylon's decal map),
// so it moves with every bend of the body and costs nothing to draw.
//
// Sizes are real: each mark is painted at the size of the thing that made it,
// using how many texture units a metre of skin takes up where it landed.

import * as BABYLON from '@babylonjs/core';

const SIZE = 2048;

export class Marks {
    declare skin: BABYLON.DynamicTexture;
    declare cloth: BABYLON.DynamicTexture;
    declare _dirty: Set<BABYLON.DynamicTexture>;
    declare _soaked: Map<any, number>;
    declare _flush: BABYLON.Observer<BABYLON.Scene>;
    declare scene: BABYLON.Scene;

    constructor(scene, npc) {
        this.scene = scene;
        this._dirty = new Set();
        this._soaked = new Map();
        const sheet = (name, mesh) => {
            const t = new BABYLON.DynamicTexture(name, { width: SIZE, height: SIZE }, scene, true);
            t.hasAlpha = true;
            t.getContext().clearRect(0, 0, SIZE, SIZE);
            t.update();
            (mesh as any).decalMap = { texture: t, isReady: () => true, dispose() {} };
            for (const m of (mesh.material as BABYLON.MultiMaterial).subMaterials) {
                if (m && /person_(skin|cloth)/.test(m.name)) {
                    const decal = (m as any).decalMap;
                    if (decal) decal.isEnabled = true;
                }
            }
            return t;
        };
        this.skin = sheet(npc.person.mesh.name + '_wounds', npc.person.mesh);
        this.cloth = sheet(npc.person.mesh.name + '_stains', npc.clothes);
        // Painted marks go up to the card once a frame, however many were painted.
        this._flush = scene.onBeforeRenderObservable.add(() => {
            for (const t of this._dirty) t.update();
            this._dirty.clear();
        });
    }

    _paint(hit, draw) {
        const t = hit.kind === 'cloth' ? this.cloth : this.skin;
        const g = t.getContext() as CanvasRenderingContext2D;
        const x = hit.uv[0] * SIZE, y = (1 - hit.uv[1]) * SIZE;
        const px = (metres) => Math.max(1, metres * hit.scale * SIZE);
        g.save();
        draw(g, x, y, px);
        g.restore();
        this._dirty.add(t);
    }

    // Where something went through: `size` across in metres, `out` for the way out (torn, bigger, everted).
    hole(hit, size, out) {
        this._paint(hit, (g, x, y, px) => {
            const r = px(size / 2);
            if (hit.kind === 'cloth') {
                ragged(g, x, y, r * (out ? 1.4 : 1.1), 'rgba(8,6,6,0.97)', out ? 0.45 : 0.25);
                return;
            }
            // A ring of scraped skin round a way in; a split, everted star for a way out.
            soft(g, x, y, r * (out ? 2.6 : 2.2), out ? 'rgba(120,20,18,0.75)' : 'rgba(115,38,30,0.8)');
            if (out) ragged(g, x, y, r * 1.3, 'rgba(70,6,6,0.95)', 0.55);
            soft(g, x, y, r * 1.05, 'rgba(25,2,2,1)');
            soft(g, x, y, r * 0.6, 'rgba(8,0,0,1)');
        });
    }

    // A blade drawn across from `a` to `b` (two hits on the same skin): an open line with the fat showing at its lips.
    cut(a, b, depth) {
        if (a.kind !== b.kind || Math.hypot(a.uv[0] - b.uv[0], a.uv[1] - b.uv[1]) > 0.05) return;
        this._paint(a, (g, x, y, px) => {
            const x2 = b.uv[0] * SIZE, y2 = (1 - b.uv[1]) * SIZE;
            const w = px(Math.min(0.006, 0.0015 + depth * 0.15));
            g.lineCap = 'round';
            if (a.kind === 'skin') {
                g.strokeStyle = 'rgba(140,40,32,0.7)';
                g.lineWidth = w * 2.6;
                g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
                g.strokeStyle = 'rgba(220,190,120,0.8)';
                g.lineWidth = w * 1.4;
                g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
            }
            g.strokeStyle = a.kind === 'skin' ? 'rgba(45,3,3,1)' : 'rgba(10,8,8,0.95)';
            g.lineWidth = w;
            g.beginPath(); g.moveTo(x, y); g.lineTo(x2, y2); g.stroke();
        });
    }

    // A bruise where a blow landed.
    bruise(hit, size) {
        if (!hit) return;
        this._paint(hit, (g, x, y, px) => {
            soft(g, x, y, px(size), 'rgba(70,20,45,0.45)');
            soft(g, x, y, px(size * 0.5), 'rgba(90,15,30,0.4)');
        });
    }

    // Blood soaking out round a wound into the skin and the clothes over it, as `litres` more of it comes out.
    soak(bleed, litres) {
        const mark = bleed.source?.mark;
        if (!mark) return;
        const total = (this._soaked.get(bleed) ?? 0) + litres;
        const last = this._soaked.get(bleed) ?? 0;
        this._soaked.set(bleed, total);
        // Painted again each time another few millilitres have come.
        if (Math.floor(total / 0.004) === Math.floor(last / 0.004)) return;
        const r = Math.min(0.2, 0.012 + Math.sqrt(total) * 0.12);
        const paint = (hit, colour) => this._paint(hit, (g, x, y, px) => soft(g, x, y, px(r), colour));
        paint(mark, 'rgba(95,4,4,0.16)');
        if (mark.cloth) paint(mark.cloth, 'rgba(60,2,2,0.2)');
    }

    dispose() {
        this.scene.onBeforeRenderObservable.remove(this._flush);
        this.skin.dispose();
        this.cloth.dispose();
    }
}

function soft(g, x, y, r, colour) {
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, colour);
    grad.addColorStop(0.7, colour);
    grad.addColorStop(1, colour.replace(/[\d.]+\)$/, '0)'));
    g.fillStyle = grad;
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
}

// A hole with a torn edge: `jag` is how far in and out its edge wanders.
function ragged(g, x, y, r, colour, jag) {
    g.fillStyle = colour;
    g.beginPath();
    const n = 11;
    for (let k = 0; k <= n; k++) {
        const a = (k / n) * Math.PI * 2, rr = r * (1 - jag / 2 + Math.random() * jag);
        g.lineTo(x + Math.cos(a) * rr, y + Math.sin(a) * rr);
    }
    g.fill();
}
