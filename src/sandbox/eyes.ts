// The eyes hurt: what a bullet, a pellet or fragment, a blade and a blow do to the globe, as it looks and as it works
// (dev/research/eye-trauma.md).
//
// The eye is MakeHuman's eyeball, one sphere a side carried by the eye bone (the bone's head is the sphere's centre),
// the white and the iris painted on it and a clear cornea over it. What the eye shows of its hurt is drawn on the eye
// itself (EyeLayer, the eye material's own): the hole or the cut in its wall, the dark uvea pushed out through it, the
// bright red of blood under the conjunctiva spreading over the white, and blood in the front chamber, a red haze that
// settles into a layer with a flat top, level in the world however the head is turned. An eye whose contents are
// lost goes soft and falls in: its bone is shrunk front to back and drawn back into the socket. What comes out of it
// runs from the lower lid down the face (runs.ts). The eye is blind (vitals.blind), the face stops using it (face.ts:
// it no longer fixes on anything and follows the other one), the lids clamp shut on it, and the pain brings the
// scream and the hand to it (npc's cries, behaviour's tending).

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3;

const SIZE = 256;           // the damage sheet, over the eye texture's own UV sheet
const SCLERA = 0.265;       // UV radius of each eye's painted disc (the white ends there)

type Side = 'L' | 'R';
type Patch = { u: number; v: number; r: number; to: number; tau: number; dense: number };
type Mark = { u: number; v: number; r: number; du?: number; dv?: number; kind: 'hole' | 'pellet' | 'slit' };
type Eye = {
    side: Side;
    centre: number[];       // the iris's centre on the UV sheet
    iris: BABYLON.Vector3;  // the iris's centre on the body at rest
    // How much of the globe's contents are gone (0 to 1, where it is headed and where it is now): it collapses as they go.
    lost: number; collapse: number;
    blood: number; bloodTo: number; settled: number;    // blood in the front chamber (share of it) and how much has settled
    patches: Patch[];       // blood under the conjunctiva
    marks: Mark[];          // holes and cuts in the wall
    blind: boolean;
    clamp: number;          // lids clamped shut against it (reflex blepharospasm), 0 to 1
    pupil: number;          // a pupil that no longer works, mm (torn sphincter: wide), or 0
    sunk: number;           // metres the eye sits back in the socket (a blown-out floor)
    t: number;
};

export class Eyes {
    declare npc: any;
    declare eye: Record<Side, Eye>;
    declare texture: BABYLON.DynamicTexture;
    declare g: CanvasRenderingContext2D;
    declare irisUv: number;
    declare irisM: number;      // metres across the iris's radius
    declare uvPerM: number;
    declare rest: Record<Side, BABYLON.Vector3>;
    declare dirty: boolean;
    declare painted: number;
    declare clock: number;
    declare busy: boolean;      // anything still changing
    declare broken: number;     // breaks bones.ts had when last looked at

    constructor(npc, material: BABYLON.Material | null, iris: { centres: number[]; iris: number }) {
        this.npc = npc;
        const person = npc.person, by = person.byName;
        this.irisUv = iris.iris;
        // Which painted eye is which, and how big the painted one is, from the mesh itself.
        const { arrays } = person.lib.bodies.get(person.bodyName), part = person.header.parts.find((p) => p.kind === 'eyes');
        const uv = arrays.uv, pos = arrays.position, joints = arrays.joints, names = person.header.bones.map((b) => b.name);
        const near = { L: [Infinity, 0], R: [Infinity, 0] } as Record<Side, number[]>;
        const centres = [[iris.centres[0], iris.centres[1]], [iris.centres[2], iris.centres[3]]];
        const sides: Record<Side, number> = { L: 0, R: 1 };
        let scale = 0, counted = 0;
        if (part) {
            for (let v = part.vertexStart; v < part.vertexStart + part.vertexCount; v++) {
                const side = names[joints[v * 4]]?.slice(-1) as Side;
                if (side !== 'L' && side !== 'R') continue;
                for (let k = 0; k < 2; k++) {
                    const d = Math.hypot(uv[v * 2] - centres[k][0], uv[v * 2 + 1] - centres[k][1]);
                    if (d < near[side][0] && d < 0.1) { near[side] = [d, v]; sides[side] = k; }
                }
            }
            // Metres of eye to a unit of the sheet near the iris: from the iris's middle out to a third of the way past it.
            for (const s of ['L', 'R'] as Side[]) {
                const c = near[s][1], cu = uv[c * 2], cv = uv[c * 2 + 1];
                for (let v = part.vertexStart; v < part.vertexStart + part.vertexCount; v++) {
                    if (names[joints[v * 4]]?.slice(-1) !== s) continue;
                    const d = Math.hypot(uv[v * 2] - cu, uv[v * 2 + 1] - cv);
                    if (d < 0.05 || d > 0.14) continue;
                    scale += Math.hypot(pos[v * 3] - pos[c * 3], pos[v * 3 + 1] - pos[c * 3 + 1], pos[v * 3 + 2] - pos[c * 3 + 2]) / d;
                    counted++;
                }
            }
        }
        this.uvPerM = counted ? counted / scale : 50;
        this.irisM = this.irisUv / this.uvPerM;
        const make = (s: Side): Eye => {
            const c = near[s][1];
            return { side: s, centre: centres[sides[s]], iris: part ? new V3(pos[c * 3], pos[c * 3 + 1], pos[c * 3 + 2]) : by['eye.' + s].tail.clone(),
                lost: 0, collapse: 0, blood: 0, bloodTo: 0, settled: 0, patches: [], marks: [], blind: false, clamp: 0, pupil: 0, sunk: 0, t: 0 };
        };
        this.eye = { L: make('L'), R: make('R') };
        this.rest = { L: by['eye.L'].bone.position.clone(), R: by['eye.R'].bone.position.clone() };
        this.texture = new BABYLON.DynamicTexture(`eyes_${person.mesh.name}`, { width: SIZE, height: SIZE }, person.scene, true);
        this.texture.wrapU = this.texture.wrapV = BABYLON.Texture.CLAMP_ADDRESSMODE;
        this.g = this.texture.getContext() as CanvasRenderingContext2D;
        this.g.clearRect(0, 0, SIZE, SIZE);
        this.texture.update(false);
        this.dirty = false;
        this.painted = 0;
        this.clock = 0;
        this.busy = false;
        this.broken = 0;
        if (material) new EyeLayer(material, this);
    }

    dispose() { this.texture.dispose(); }

    // Which eye a crossing of it (surface()'s, kind 'eye') is.
    sideOf(hit): Side { return /\.L$/.test(hit.owner?.name ?? '') ? 'L' : /\.R$/.test(hit.owner?.name ?? '') ? 'R' : V3.Distance(hit.rest, this.npc.person.byName['eye.L'].head) < V3.Distance(hit.rest, this.npc.person.byName['eye.R'].head) ? 'L' : 'R'; }

    // The skin of the lower lid's edge on side `s`, where what comes out of the eye runs from (a crossing, runs.ts's).
    lid(s: Side) {
        const by = this.npc.person.byName, e = by['eye.' + s].head;
        return this.npc.runs.nearest(new V3(e.x, e.y - 0.012, e.z + 0.012), 0.02);
    }

    // The eye at crossing `hit` met by missile `m` going along `dir`: a bullet, a pellet or fragment, or a blade's point
    // (wounds.ts pierce). `deep` is how far into the body it went.
    pierced(hit, m, dir: BABYLON.Vector3, deep: number, through: boolean) {
        const s = this.sideOf(hit), e = this.eye[s], v = this.npc.vitals, word = s === 'L' ? 'left' : 'right';
        const [u, w] = hit.uv, per = this.uvPerM;
        e.t = 0;
        if (m.blade) {
            // A blade's point: a straight cut as wide as the blade where it went in, along its edge (the direction across
            // the sheet found by a second line beside the first). Aqueous goes at once and the chamber falls flat; the
            // iris is carried into the cut; deeper, lens and vitreous follow (eye-trauma.md sec. 2, Blade).
            const width = m.calibre * Math.min(1, Math.max(0.15, deep / (m.taper ?? 0.01)));
            let du = 1, dv = 0;
            if (m.across) {
                const o = hit.point.subtract(dir.scale(0.05)).add(m.across.scale(0.002));
                const two = this.npc.surface(o, dir, 0.1, true).find((h) => h.kind === 'eye' && this.sideOf(h) === s);
                if (two) { const a = two.uv[0] - u, b = two.uv[1] - w, l = Math.hypot(a, b); if (l > 1e-5) { du = a / l; dv = b / l; } }
            }
            e.marks.push({ u, v: w, r: Math.min(0.12, (width / 2) * per), du, dv, kind: 'slit' });
            e.lost = Math.max(e.lost, deep > 0.012 ? 0.55 : 0.25);
            e.bloodTo = Math.max(e.bloodTo, 0.35 + Math.random() * 0.3);
            e.patches.push({ u, v: w, r: 0.02, to: 0.09 + Math.random() * 0.05, tau: 12, dense: 0.9 });
            v.injure(`${cap(word)} eye cut open by the blade: blind in it`, 7);
        } else if (m.name || m.calibre < 0.005) {
            // A pellet or a fragment: a small hole, often a second one behind; the globe goes soft, blood fills the chamber.
            e.marks.push({ u, v: w, r: Math.max(0.006, (m.calibre / 2) * per * 1.2), kind: 'pellet' });
            e.lost = Math.min(0.8, e.lost + (through ? 0.4 : 0.25));
            e.bloodTo = Math.min(1, e.bloodTo + 0.45 + Math.random() * 0.3);
            e.patches.push({ u, v: w, r: 0.01, to: 0.07 + Math.random() * 0.05, tau: 15, dense: 0.85 });
            v.injure(`${cap(m.name ?? 'fragment')} in the ${word} eye: blind in it`, 7);
        } else {
            // A bullet: the globe burst and emptied, its wall split round the hole, flat and wrinkled within a second.
            e.marks.push({ u, v: w, r: Math.max(0.05, (m.calibre / 2) * per * 2.2), kind: 'hole' });
            e.lost = 1;
            e.bloodTo = 1;
            e.patches.push({ u: e.centre[0], v: e.centre[1], r: 0.05, to: SCLERA, tau: 2.5, dense: 1 });
            v.injure(`${cap(word)} eye destroyed by the bullet`, 9);
        }
        this._blinded(e, 1);
        // What runs from it: blood with the eye's own fluid, little in all (the globe holds about 7 ml) but more from a
        // bullet that tore the vessels of the orbit behind it (eye-trauma.md sec. 4).
        const lid = this.lid(s);
        const rate = m.blade ? 0.00012 : m.name ? 0.00006 : 0.0006;
        v.bleed({ name: `${word} eye`, rate, clots: m.blade || m.name ? 0.02 : 0.006, source: lid ? { mark: lid } : undefined });
        if (lid) this.npc.welling(lid, m.blade || m.name ? 0.08 : 0.4);
        this.dirty = true;
        return lid;
    }

    // A blow landing at `point` (world) along `dir`: `energy` J, `narrow` when what landed is smaller than the orbit's rim
    // (a bat's end, a hammer, an edge) rather than a fist, which the rim mostly takes (eye-trauma.md sec. 2, Punch).
    struck(point: BABYLON.Vector3, dir: BABYLON.Vector3, energy: number, narrow: boolean) {
        const v = this.npc.vitals, by = this.npc.person.byName;
        for (const s of ['L', 'R'] as Side[]) {
            const e = this.eye[s], at = this.npc.worldOf(by['eye.' + s].head, by['eye.' + s]).at;
            const d = V3.Distance(at, point);
            if (d > (narrow ? 0.03 : 0.045)) continue;
            const k = Math.max(0, 1 - d / (narrow ? 0.03 : 0.045)), word = s === 'L' ? 'left' : 'right';
            e.t = 0;
            e.clamp = Math.max(e.clamp, 0.8 * k);
            // Blood under the conjunctiva, coming up over minutes where the white was pressed.
            if (Math.random() < 0.3 + energy / 60) {
                const a = Math.random() * Math.PI * 2, r = 0.13 + Math.random() * 0.08;
                e.patches.push({ u: e.centre[0] + Math.cos(a) * r, v: e.centre[1] + Math.sin(a) * r, r: 0.005, to: 0.04 + 0.06 * Math.random() * k, tau: 60, dense: 0.8 });
                v.injure(`Blood under the white of the ${word} eye`, 1);
            }
            // The iris root torn by the eye's sudden squash: blood in the front chamber over the next minutes (a hyphaema),
            // and now and then the pupil's sphincter torn, leaving it wide.
            if (Math.random() < Math.min(0.85, energy / (narrow ? 25 : 120)) * k) {
                e.bloodTo = Math.min(1, e.bloodTo + Math.min(0.6, 0.08 + energy / 250));
                v.injure(`Blood in the front of the ${word} eye`, 3);
                if (Math.random() < 0.3) e.pupil = 6 + Math.random();
            }
            // Broken open by something narrow and hard enough: the wall splits where it is thinnest, away from the blow,
            // round the cornea's edge or behind the muscles' insertions (contrecoup), with dense red all round.
            if (narrow && energy * k > 35) {
                const a = Math.random() * Math.PI * 2;
                e.marks.push({ u: e.centre[0] + Math.cos(a) * this.irisUv * 1.25, v: e.centre[1] + Math.sin(a) * this.irisUv * 1.25, r: 0.06, du: -Math.sin(a), dv: Math.cos(a), kind: 'slit' });
                e.lost = Math.max(e.lost, 0.5);
                e.bloodTo = 1;
                e.patches.push({ u: e.centre[0], v: e.centre[1], r: 0.05, to: SCLERA, tau: 6, dense: 1 });
                this._blinded(e, k);
                v.injure(`${cap(word)} eye burst by the blow: blind in it`, 8);
                const lid = this.lid(s);
                v.bleed({ name: `${word} eye`, rate: 0.0001, clots: 0.02, source: lid ? { mark: lid } : undefined });
                if (lid) this.npc.welling(lid, 0.1);
            }
            this.dirty = true;
        }
    }

    _blinded(e: Eye, k: number) {
        const v = this.npc.vitals;
        e.blind = true;
        e.clamp = 1;
        v.blind = v.blind ?? { L: false, R: false };
        v.blind[e.side] = true;
        // The most densely innervated surface of the body opened: as much pain as there is.
        v.pain = Math.min(1, Math.max(v.pain + 0.6 * k, 0.9 * k));
    }

    // Blind or gone on side `s`.
    blind(s: Side) { return this.eye[s].blind; }

    // How far the lids on side `s` are clamped shut, by an awake person (`alert`, face.ts's): hard at first, easing over a
    // minute to a squint the light still hurts through; the other eye screws up with it for the first seconds.
    shut(s: Side, alert: number) {
        const e = this.eye[s], o = this.eye[s === 'L' ? 'R' : 'L'];
        const own = e.clamp * (0.65 + 0.35 * Math.exp(-e.t / 40));
        const other = o.clamp * 0.6 * Math.exp(-o.t / 4);
        return Math.max(own, other) * alert;
    }

    update(dt: number) {
        this.clock += dt;
        let busy = false;
        for (const s of ['L', 'R'] as Side[]) {
            const e = this.eye[s];
            e.t += dt;
            // What is lost goes in the first second (the wall's tension spends itself); the eye falls in after it.
            if (Math.abs(e.lost - e.collapse) > 1e-3) { e.collapse += (e.lost - e.collapse) * Math.min(1, dt / 0.35); busy = true; }
            // Blood comes into the chamber over seconds (a burst eye) to minutes (a blow), then settles.
            if (e.bloodTo - e.blood > 1e-3) { e.blood += (e.bloodTo - e.blood) * Math.min(1, dt / (e.lost >= 1 ? 1.2 : e.lost > 0 ? 8 : 40)); busy = true; }
            if (e.blood > 0.01 && e.settled < 0.999) { e.settled += (1 - e.settled) * Math.min(1, dt / 90); busy = true; }
            for (const p of e.patches) if (p.to - p.r > 1e-4) { p.r += (p.to - p.r) * Math.min(1, dt / p.tau); this.dirty = true; }
            if (e.clamp > 0 && this.npc.vitals.dead) e.clamp = 0;
        }
        this.busy = busy;
        // A blown-out floor lets the eye sink back and down a little at once (more as the swelling goes, days later:
        // eye-trauma.md sec. 2, Punch).
        const breaks = this.npc.bones?.breaks;
        if (breaks && breaks.length !== this.broken) {
            this.broken = breaks.length;
            for (const br of breaks) if (br.type === 'blowout' && (br.side === 'L' || br.side === 'R')) this.eye[br.side].sunk = 0.0015;
        }
        if (this.dirty && this.clock - this.painted > 0.15) this._paint();
    }

    // The eye bones: a collapsed eye smaller front to back and drawn back, a blown-out floor letting it sink.
    // (Called after face.ts has turned them.)
    pose() {
        for (const s of ['L', 'R'] as Side[]) {
            const e = this.eye[s], c = e.collapse;
            if (c < 1e-3 && e.sunk === 0) continue;
            const bone = this.npc.person.byName['eye.' + s].bone as BABYLON.Bone;
            bone.setScale(_s.set(1 - 0.12 * c, 1 - 0.22 * c, 1 - 0.5 * c));
            bone.position = _p.copyFrom(this.rest[s]).addInPlaceFromFloats(0, -0.4 * e.sunk, -0.004 * c - e.sunk);
        }
    }

    // The damage sheet, drawn whole from the state (it is small).
    _paint() {
        const g = this.g;
        this.painted = this.clock;
        this.dirty = false;
        g.clearRect(0, 0, SIZE, SIZE);
        for (const e of Object.values(this.eye)) {
            const [cu, cv] = e.centre;
            // Blood under the conjunctiva: bright red, flat, sharp-edged, on the white only (the cornea's edge is its limit).
            g.save();
            g.beginPath();
            g.arc(cu * SIZE, cv * SIZE, SCLERA * SIZE, 0, Math.PI * 2);
            g.arc(cu * SIZE, cv * SIZE, this.irisUv * 1.03 * SIZE, 0, Math.PI * 2, true);
            g.clip('evenodd');
            for (const p of e.patches) {
                const x = p.u * SIZE, y = p.v * SIZE, r = Math.max(1, p.r * SIZE);
                const grad = g.createRadialGradient(x, y, 0, x, y, r);
                grad.addColorStop(0, `rgba(150,10,12,${0.95 * p.dense})`);
                grad.addColorStop(0.75, `rgba(160,14,14,${0.85 * p.dense})`);
                grad.addColorStop(1, 'rgba(170,20,20,0)');
                g.fillStyle = grad;
                g.beginPath();
                g.arc(x, y, r, 0, Math.PI * 2);
                g.fill();
            }
            g.restore();
            for (const mk of e.marks) {
                const x = mk.u * SIZE, y = mk.v * SIZE, r = Math.max(1.5, mk.r * SIZE);
                if (mk.kind === 'slit') {
                    // The cut: gaping a little, its lips dark with the uvea behind; at its end nearest the pupil, a knuckle
                    // of iris carried into it.
                    const dx = mk.du * r, dy = mk.dv * r;
                    g.lineCap = 'round';
                    g.strokeStyle = 'rgba(120,10,10,0.75)';
                    g.lineWidth = Math.max(2.5, r * 0.35);
                    line(g, x - dx, y - dy, x + dx, y + dy);
                    g.strokeStyle = 'rgba(28,10,8,0.95)';
                    g.lineWidth = Math.max(1.2, r * 0.16);
                    line(g, x - dx, y - dy, x + dx, y + dy);
                    const ends = [[x - dx, y - dy], [x + dx, y + dy]];
                    const [kx, ky] = ends.sort((a, b) => Math.hypot(a[0] - cu * SIZE, a[1] - cv * SIZE) - Math.hypot(b[0] - cu * SIZE, b[1] - cv * SIZE))[0];
                    blob(g, kx * 0.6 + x * 0.4, ky * 0.6 + y * 0.4, Math.max(1.5, r * 0.28), 'rgba(52,26,16,0.95)');
                } else {
                    // A hole: the wall split round it in ragged tongues, dark brown-black uvea and retina pushed out, blood.
                    const blood = g.createRadialGradient(x, y, 0, x, y, r * 1.9);
                    blood.addColorStop(0, 'rgba(90,6,6,0.9)');
                    blood.addColorStop(1, 'rgba(110,8,8,0)');
                    g.fillStyle = blood;
                    g.beginPath();
                    g.arc(x, y, r * 1.9, 0, Math.PI * 2);
                    g.fill();
                    ragged(g, x, y, r, 'rgba(48,24,16,0.97)', mk.u * 7 + mk.v * 13);
                    ragged(g, x, y, r * 0.62, 'rgba(14,4,3,1)', mk.u * 11 + mk.v * 5);
                }
            }
        }
        this.texture.update(false);
    }

    // For the shader: per eye on the sheet (A is the first iris centre in the shared table, as PupilLayer has them).
    which(k: 0 | 1) { return Object.values(this.eye).find((e) => e.centre === this.eyeCentres()[k]) ?? this.eye.L; }
    eyeCentres() { return [this.eye.L.centre, this.eye.R.centre].sort((a, b) => b[0] - a[0]); }
}

const _s = new V3(), _p = new V3();
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);

function line(g: CanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number) { g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
function blob(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string) { g.fillStyle = fill; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.fill(); }
// A disc with a torn edge (the same tears each time it is drawn: `seed`).
function ragged(g: CanvasRenderingContext2D, x: number, y: number, r: number, fill: string, seed: number) {
    g.fillStyle = fill;
    g.beginPath();
    const n = 18;
    for (let i = 0; i <= n; i++) {
        const a = (i / n) * Math.PI * 2, k = 0.7 + 0.45 * Math.abs(Math.sin(seed + i * 2.399) * Math.sin(seed * 0.7 + i * 1.13));
        if (i === 0) g.moveTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
        else g.lineTo(x + Math.cos(a) * r * k, y + Math.sin(a) * r * k);
    }
    g.fill();
}

const _w = new V3();

// The eye drawn hurt: the damage sheet over the picture; blood in the front chamber, its top level in the world; a
// collapsed globe's wall wrinkled. After PupilLayer (the iris drawn first, then what lies over it).
export class EyeLayer extends BABYLON.MaterialPluginBase {
    declare eyes: Eyes;

    constructor(material: BABYLON.Material, eyes: Eyes) {
        super(material, 'EyeHurt', 212, { EYEHURT: false });
        this.eyes = eyes;
        this._enable(true);
    }

    getClassName() { return 'EyeLayer'; }

    prepareDefines(defines) { defines.EYEHURT = true; }

    getSamplers(samplers) { samplers.push('eyeDamage'); }

    getUniforms() {
        return { ubo: [{ name: 'eyeCentres', size: 4, type: 'vec4' }, { name: 'eyeIris', size: 2, type: 'vec2' },
            { name: 'eyeWorldA', size: 4, type: 'vec4' }, { name: 'eyeWorldB', size: 4, type: 'vec4' },
            { name: 'eyeStateA', size: 4, type: 'vec4' }, { name: 'eyeStateB', size: 4, type: 'vec4' }] };
    }

    bindForSubMesh(ubo) {
        const eyes = this.eyes, [a, b] = eyes.eyeCentres();
        ubo.updateFloat4('eyeCentres', a[0], a[1], b[0], b[1]);
        ubo.updateFloat2('eyeIris', eyes.irisUv, eyes.irisM);
        for (const [k, name] of [[0, 'A'], [1, 'B']] as const) {
            const e = eyes.which(k);
            // The iris's centre in the world now (only wanted with blood in the chamber).
            if (e.blood > 0.005) {
                const by = eyes.npc.person.byName['eye.' + e.side];
                V3.TransformCoordinatesToRef(e.iris, eyes.npc.restToWorld(by), _w);
            } else _w.set(0, -1e3, 0);
            const layer = e.blood * e.settled;
            ubo.updateFloat4('eyeWorld' + name, _w.x, _w.y, _w.z, e.blood > 0.95 ? 1.05 : layer);
            ubo.updateFloat4('eyeState' + name, e.blood * (1 - e.settled) * 0.85, e.collapse, Math.min(1, e.t / 600) * (e.blood > 0.9 ? 1 : 0.3), 0);
        }
        ubo.setTexture('eyeDamage', eyes.texture);
    }

    getActiveTextures(textures) { textures.push(this.eyes.texture); }

    hasTexture(texture) { return texture === this.eyes.texture; }

    getCustomCode(shaderType) {
        if (shaderType !== 'fragment') return null;
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: '#ifdef EYEHURT\nuniform sampler2D eyeDamage;\n#endif\n',
            CUSTOM_FRAGMENT_UPDATE_ALPHA: `
#ifdef EYEHURT
{
    vec2 eu = vMainUV1;
    bool ea = distance(eu, eyeCentres.xy) < distance(eu, eyeCentres.zw);
    vec2 ec = ea ? eyeCentres.xy : eyeCentres.zw;
    vec4 ew = ea ? eyeWorldA : eyeWorldB;
    vec4 es = ea ? eyeStateA : eyeStateB;
    float er = distance(eu, ec) / eyeIris.x;
    // Blood in the front chamber, seen through the cornea: over the iris and pupil only, a haze while it is stirred up, a
    // layer with a flat top once it settles (its top level in the world), darkening as it clots.
    if (er < 1.03 && (ew.w > 0.001 || es.x > 0.001)) {
        float top = ew.y - eyeIris.y + 2.0 * eyeIris.y * ew.w;
        float under = ew.w > 0.001 ? 1.0 - smoothstep(top - 0.00025, top + 0.00025, vPositionW.y) : 0.0;
        vec3 fresh = vec3(0.28, 0.012, 0.01), clot = vec3(0.045, 0.006, 0.005);
        vec3 bl = mix(fresh, clot, es.z) * (0.75 + 0.25 * smoothstep(top - 2.0 * eyeIris.y, top, vPositionW.y));
        surfaceAlbedo = mix(surfaceAlbedo, bl, max(under, es.x) * (1.0 - smoothstep(0.97, 1.03, er)));
    }
    vec4 ed = texture2D(eyeDamage, eu);
    surfaceAlbedo = mix(surfaceAlbedo, toLinearSpace(ed.rgb), ed.a);
    // An emptied globe: its wall in folds.
    if (es.y > 0.01) {
        vec3 wp = vPositionW * 900.0;
        vec3 fold = vec3(sin(wp.y * 1.3 + sin(wp.z * 0.7) * 2.0), sin(wp.z * 1.1 + sin(wp.x * 0.9) * 2.0), sin(wp.x * 1.2 + sin(wp.y * 0.8) * 2.0));
        normalW = normalize(normalW + fold * 0.35 * es.y);
        surfaceAlbedo *= 1.0 - 0.25 * es.y;
    }
}
#endif
`,
        };
    }
}
