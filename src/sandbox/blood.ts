// Blood out of a body: drops in the air, and what they leave where they land.
//
// A drop is a point with a speed, falling under gravity with a little drag,
// drawn as a bead stretched along the way it is going. Where it lands it
// leaves a splash shaped by how fast and how slantwise it hit, and blood that
// keeps coming out of something lying on the floor spreads into a pool as
// wide as its volume makes it at a couple of millimetres deep.

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3, M = BABYLON.Matrix;

const MOST = 2500;          // drops in the air at once
const SPLATS = 5000;        // marks on the room before the oldest go
const DRAG = 0.6;           // of a drop's speed lost a second to the air
const DEEP = 0.0025;        // metres: how deep blood stands on a hard floor
const ML = 0.4;             // millilitres a drawn drop stands for
const TILES = [4, 2];       // the splash sheet: columns, rows

export class Blood {
    declare scene: BABYLON.Scene;
    declare room: { x: number; z: number; height: number };
    declare n: number;
    declare p: Float32Array;
    declare v: Float32Array;
    declare size: Float32Array;
    declare drop: BABYLON.Mesh;
    declare dropMatrices: Float32Array;
    declare marks: BABYLON.Mesh[];
    declare markCount: number[];
    declare markNext: number[];
    declare pools: BABYLON.Mesh;
    declare poolList: { at: BABYLON.Vector3; volume: number; i: number; turn: number }[];
    declare onLand: ((at: BABYLON.Vector3, speed: number) => void) | null;

    // `room` is the half-width and half-depth of the floor and the height of its walls; `reflect` what wet blood shows.
    constructor(scene, room, reflect = null) {
        this.scene = scene;
        this.room = room;
        this.n = 0;
        this.p = new Float32Array(MOST * 3);
        this.v = new Float32Array(MOST * 3);
        this.size = new Float32Array(MOST);
        this.onLand = null;

        const wet = (name, texture) => {
            const m = new BABYLON.PBRMaterial(name, scene);
            m.albedoColor = new BABYLON.Color3(0.32, 0.018, 0.014);
            m.metallic = 0;
            m.roughness = 0.12;
            m.reflectionTexture = reflect;
            m.environmentIntensity = 0.6;
            if (texture) {
                m.albedoTexture = texture;
                m.useAlphaFromAlbedoTexture = true;
                m.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
                m.zOffset = -2;
                m.backFaceCulling = false;
            }
            return m;
        };
        this.drop = BABYLON.MeshBuilder.CreateSphere('drop', { segments: 4, diameter: 1 }, scene);
        this.drop.material = wet('dropBlood', null);
        this.drop.isPickable = false;
        this.dropMatrices = new Float32Array(MOST * 16);
        this.drop.thinInstanceSetBuffer('matrix', this.dropMatrices, 16, false);
        this.drop.thinInstanceCount = 0;
        this.drop.alwaysSelectAsActiveMesh = true;
        this.drop.isVisible = false;

        const sheet = splashSheet(scene);
        const material = wet('splatBlood', sheet);
        this.marks = [];
        this.markCount = [];
        this.markNext = [];
        const [cols, rows] = TILES;
        for (let k = 0; k < cols * rows; k++) {
            const quad = BABYLON.MeshBuilder.CreatePlane('splat' + k, { size: 1, frontUVs: tile(k), sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
            quad.material = material;
            quad.isPickable = false;
            quad.alwaysSelectAsActiveMesh = true;
            quad.thinInstanceSetBuffer('matrix', new Float32Array((SPLATS / (cols * rows)) * 16), 16, false);
            quad.thinInstanceCount = 0;
            quad.isVisible = false;
            this.marks.push(quad);
            this.markCount.push(0);
            this.markNext.push(0);
        }
        // Pools: the round soft splash, scaled as they fill.
        this.pools = BABYLON.MeshBuilder.CreatePlane('pools', { size: 1, sideOrientation: BABYLON.Mesh.DOUBLESIDE }, scene);
        this.pools.isVisible = false;
        this.pools.material = wet('poolBlood', poolSheet(scene));
        this.pools.isPickable = false;
        this.pools.alwaysSelectAsActiveMesh = true;
        this.pools.thinInstanceSetBuffer('matrix', new Float32Array(256 * 16), 16, false);
        this.pools.thinInstanceCount = 0;
        this.poolList = [];
    }

    // Drops thrown out from `at` along `dir` (unit) at `speed` m/s, spread by `cone` (radians); `ml` the blood in all.
    spray(at: BABYLON.Vector3, dir: BABYLON.Vector3, speed: number, ml: number, cone = 0.25, big = 1) {
        const count = Math.min(200, Math.max(1, Math.round(ml / ML)));
        for (let k = 0; k < count && this.n < MOST; k++) {
            const i = this.n++;
            const s = speed * (0.55 + Math.random() * 0.6);
            const jx = (Math.random() - 0.5) * 2 * cone, jy = (Math.random() - 0.5) * 2 * cone, jz = (Math.random() - 0.5) * 2 * cone;
            this.p[i * 3] = at.x; this.p[i * 3 + 1] = at.y; this.p[i * 3 + 2] = at.z;
            this.v[i * 3] = (dir.x + jx) * s; this.v[i * 3 + 1] = (dir.y + jy) * s; this.v[i * 3 + 2] = (dir.z + jz) * s;
            this.size[i] = (0.0025 + Math.random() * 0.004) * big;
        }
    }

    // Blood leaving a wound at `at` at `rate` litres a second for `dt`: dripping, or into a pool if it is on the floor.
    run(at: BABYLON.Vector3, rate: number, dt: number, normal: BABYLON.Vector3 | null = null) {
        const ml = rate * dt * 1000;
        if (ml <= 0) return;
        if (at.y < 0.35) { this.fill(at, ml / 1000); return; }
        // Drops are drawn for a share of what runs out; the rest goes down the body, unseen.
        if (Math.random() < Math.min(1, ml / ML)) this.spray(at, normal ?? new V3(0, -1, 0), 0.25, ML, 0.6, 1.2);
    }

    // A pool on the floor under `at` takes `litres` more.
    fill(at: BABYLON.Vector3, litres: number) {
        const across = (litres) => Math.sqrt(litres / 1000 / (Math.PI * DEEP));
        let pool = this.poolList.find((p) => Math.hypot(p.at.x - at.x, p.at.z - at.z) < Math.max(0.06, across(p.volume) * 0.8));
        if (!pool) {
            if (this.poolList.length >= 256) return;
            pool = { at: new V3(at.x, 0.0015 + this.poolList.length * 0.00002, at.z), volume: 0, i: this.poolList.length, turn: Math.random() * Math.PI * 2 };
            this.poolList.push(pool);
            this.pools.thinInstanceCount = this.poolList.length;
            this.pools.isVisible = true;
        }
        pool.volume += litres;
        // The blob on the sheet fills about two thirds of it.
        const r = across(pool.volume) * 3;
        const m = M.Scaling(r, r, 1).multiply(M.RotationX(Math.PI / 2)).multiply(M.RotationY(pool.turn)).multiply(M.Translation(pool.at.x, pool.at.y, pool.at.z));
        this.pools.thinInstanceSetMatrixAt(pool.i, m, true);
    }

    update(dt: number) {
        const { p, v, size } = this;
        const g = 9.81 * dt, slow = Math.exp(-DRAG * dt);
        const { x: W, z: D, height: H } = this.room;
        const m = new M(), at = new V3(), vel = new V3();
        let live = 0;
        for (let i = 0; i < this.n; i++) {
            v[i * 3 + 1] -= g;
            v[i * 3] *= slow; v[i * 3 + 1] *= slow; v[i * 3 + 2] *= slow;
            const x = p[i * 3] + v[i * 3] * dt, y = p[i * 3 + 1] + v[i * 3 + 1] * dt, z = p[i * 3 + 2] + v[i * 3 + 2] * dt;
            at.set(x, y, z);
            vel.set(v[i * 3], v[i * 3 + 1], v[i * 3 + 2]);
            let normal = null;
            if (y <= 0) { normal = V3.Up(); at.y = 0; }
            else if (Math.abs(x) >= W) { normal = new V3(-Math.sign(x), 0, 0); at.x = Math.sign(x) * (W - 0.002); }
            else if (Math.abs(z) >= D) { normal = new V3(0, 0, -Math.sign(z)); at.z = Math.sign(z) * (D - 0.002); }
            else if (y >= H) { normal = V3.Down(); at.y = H - 0.002; }
            if (normal) {
                this._splash(at, vel, normal, size[i]);
                continue;
            }
            // Kept: moved down to the next free place.
            p[live * 3] = x; p[live * 3 + 1] = y; p[live * 3 + 2] = z;
            v[live * 3] = v[i * 3]; v[live * 3 + 1] = v[i * 3 + 1]; v[live * 3 + 2] = v[i * 3 + 2];
            size[live] = size[i];
            const speed = vel.length();
            const stretch = 1 + Math.min(4, speed * 0.25);
            // A bead drawn long along its way: a scale along +Y turned onto the velocity.
            const q = BABYLON.Quaternion.FromUnitVectorsToRef(V3.UpReadOnly, speed > 1e-4 ? vel.scale(1 / speed) : V3.Up(), new BABYLON.Quaternion());
            M.ComposeToRef(new V3(size[i], size[i] * stretch, size[i]), q, at, m);
            m.copyToArray(this.dropMatrices, live * 16);
            live++;
        }
        this.n = live;
        this.drop.thinInstanceCount = live;
        this.drop.isVisible = live > 0;
        if (live) this.drop.thinInstanceBufferUpdated('matrix');
    }

    // The mark a drop leaves: round if it came straight down, long and tailed the more slantwise it came.
    _splash(at: BABYLON.Vector3, vel: BABYLON.Vector3, normal: BABYLON.Vector3, size: number) {
        const speed = vel.length();
        const into = speed > 1e-4 ? -V3.Dot(vel, normal) / speed : 1;
        const slant = into < 0.6;
        const kind = slant ? 4 + Math.floor(Math.random() * 4) : Math.floor(Math.random() * 4);
        const spread = size * (2.2 + Math.min(4, speed * 0.35)) * (0.8 + Math.random() * 0.5);
        const along = vel.subtract(normal.scale(V3.Dot(vel, normal)));
        const across = along.lengthSquared() > 1e-8 ? along.normalize() : V3.Cross(normal, Math.abs(normal.y) > 0.9 ? V3.Right() : V3.Up()).normalize();
        const side = V3.Cross(normal, across).normalize();
        // The quad's +X along the drop's way, +Y across, -Z (its face) away from the surface.
        const long = slant ? 1 / Math.max(0.25, into) : 1;
        const m = M.FromValues(
            across.x * spread * long, across.y * spread * long, across.z * spread * long, 0,
            side.x * spread, side.y * spread, side.z * spread, 0,
            -normal.x, -normal.y, -normal.z, 0,
            at.x + normal.x * 0.001, at.y + normal.y * 0.001, at.z + normal.z * 0.001, 1);
        const mesh = this.marks[kind], cap = SPLATS / this.marks.length;
        const slot = this.markNext[kind];
        mesh.thinInstanceSetMatrixAt(slot, m, true);
        this.markNext[kind] = (slot + 1) % cap;
        this.markCount[kind] = Math.min(cap, this.markCount[kind] + 1);
        mesh.thinInstanceCount = this.markCount[kind];
        mesh.isVisible = true;
        this.onLand?.(at, speed);
    }

    clear() {
        this.n = 0;
        this.drop.thinInstanceCount = 0;
        this.marks.forEach((m, k) => { m.thinInstanceCount = 0; m.isVisible = false; this.markCount[k] = 0; this.markNext[k] = 0; });
        this.poolList = [];
        this.pools.thinInstanceCount = 0;
        this.pools.isVisible = false;
    }
}

// The UVs of tile k of the splash sheet, as [u0, v0, u1, v1].
function tile(k) {
    const [cols, rows] = TILES;
    const c = k % cols, r = Math.floor(k / cols);
    return new BABYLON.Vector4(c / cols, 1 - (r + 1) / rows, (c + 1) / cols, 1 - r / rows);
}

// Eight splashes painted once: four round (a drop that fell straight) and four long with a tail and the spatter
// thrown ahead of it (one that came in at a slant, travelling along +X of its tile).
function splashSheet(scene) {
    const S = 256, [cols, rows] = TILES;
    const texture = new BABYLON.DynamicTexture('splashes', { width: S * cols, height: S * rows }, scene, true);
    const g = texture.getContext() as CanvasRenderingContext2D;
    g.clearRect(0, 0, S * cols, S * rows);
    const blob = (x, y, r, a = 1) => {
        const grad = g.createRadialGradient(x, y, 0, x, y, r);
        grad.addColorStop(0, `rgba(255,255,255,${a})`);
        grad.addColorStop(0.75, `rgba(235,235,235,${a})`);
        grad.addColorStop(1, 'rgba(200,200,200,0)');
        g.fillStyle = grad;
        g.beginPath();
        g.arc(x, y, r, 0, Math.PI * 2);
        g.fill();
    };
    for (let k = 0; k < cols * rows; k++) {
        const ox = (k % cols) * S, oy = Math.floor(k / cols) * S, cx = ox + S / 2, cy = oy + S / 2;
        g.save();
        g.beginPath();
        g.rect(ox, oy, S, S);
        g.clip();
        if (k < 4) {
            // A crown: the body of the drop with a ragged edge and the droplets it threw out round it.
            const lobes = 14 + k * 3;
            g.fillStyle = 'rgba(245,245,245,1)';
            g.beginPath();
            for (let a = 0; a <= lobes; a++) {
                const t = (a / lobes) * Math.PI * 2, r = S * (0.2 + Math.random() * 0.06);
                g.lineTo(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
            }
            g.fill();
            for (let a = 0; a < 10 + k * 5; a++) {
                const t = Math.random() * Math.PI * 2, r = S * (0.24 + Math.random() * 0.22);
                blob(cx + Math.cos(t) * r, cy + Math.sin(t) * r, S * (0.01 + Math.random() * 0.03));
            }
        } else {
            // Long along +X, the tail behind and the spatter ahead.
            g.fillStyle = 'rgba(245,245,245,1)';
            g.beginPath();
            g.ellipse(cx - S * 0.08, cy, S * 0.22, S * 0.1, 0, 0, Math.PI * 2);
            g.fill();
            for (let a = 0; a < 18; a++) {
                const t = (Math.random() - 0.5) * 0.7, r = S * (0.15 + Math.random() * 0.32);
                blob(cx + Math.cos(t) * r, cy + Math.sin(t) * r * 0.6, S * (0.008 + Math.random() * 0.025));
            }
        }
        g.restore();
    }
    texture.hasAlpha = true;
    texture.update();
    return texture;
}

// A pool's shape: a soft-edged, lobed blob, as blood spreads on a floor that is not quite flat.
function poolSheet(scene) {
    const S = 256;
    const texture = new BABYLON.DynamicTexture('pool', { width: S, height: S }, scene, true);
    const g = texture.getContext() as CanvasRenderingContext2D;
    g.clearRect(0, 0, S, S);
    g.filter = 'blur(3px)';
    g.fillStyle = 'rgba(245,245,245,1)';
    g.beginPath();
    const lobes = 9;
    for (let a = 0; a <= lobes * 4; a++) {
        const t = (a / (lobes * 4)) * Math.PI * 2;
        const r = S * (0.3 + 0.035 * Math.sin(t * lobes * 0.5 + 1.3) + 0.025 * Math.sin(t * 3.1));
        g.lineTo(S / 2 + Math.cos(t) * r, S / 2 + Math.sin(t) * r);
    }
    g.fill();
    texture.hasAlpha = true;
    texture.update();
    return texture;
}

