// The body's wall where an opening goes through it: the cut face of every layer between the skin and the cavity.
//
// An opening (viscera.ts) is a lens-shaped hole in the skin. Under it the real wall is centimetres thick, and what a
// wound through it shows is that thickness: the skin's edge, the fat, the white fascia, the muscles with their grain,
// in the chest the ribs and the intercostal muscles between them and the pleura under them, in the belly the rectus or
// the three flat muscles and the peritoneum (dev/research/body-wall.md, sections 1-2). This is that face: a ring of
// geometry from the skin's edge down to the cavity, in the person's rest space, carried by the opening's bone as the
// organs are.
//
// Each column of the ring is measured into the anatomy under that point of skin (how deep the rib, the sternum, the
// lung or the bowel is there), and the layers between are laid in at their thicknesses for that site; fat takes up what
// is left, as it does from man to man. What each layer is, how deep it ends, and which way its fibres run is given to
// the shader per corner; it draws each as it looks cut, muscle from a grain that runs along its fibres in space, so a
// face across them is stippled with the ends of fascicles and one along them is striped.

import * as BABYLON from '@babylonjs/core';
import { GLSL_BLOOD } from './fluid.ts';
const V3 = BABYLON.Vector3;

const RINGS = 14;           // from the skin down to the cavity
const FAR = 0.09;           // m looked into the anatomy under each column for the cavity

// Millimetres of each layer, a lean-to-average man (body-wall.md 1.2-1.5): skin, fascia, the muscles, the lining.
const DERMIS = 2;
const CHEST = { fascia: 0.7, pec: [6, 16], serratus: [3, 7], space: 9, lining: 1 };
const BELLY = { sheath: 1, linea: 2.5, rectus: 11, eo: 6, io: 9, ta: 5, lining: 3 };
const LINEA = 0.012;        // m either side of the midline that is linea alba
const RECTUS = 0.075;       // and that is rectus
const PECTORAL = 0.15;      // m from the midline the pectorals cover the ribs; serratus anterior past it
const CARTILAGE = 0.06;     // m from the midline a rib is costal cartilage (body-wall.md 1.3: its front 2-8 cm)

// The organs that are the cavity's contents: the wall ends where the first of them begins.
const CAVITY = /^(lung|heart|liver|stomach|bowel|colon|spleen|gallbladder|pancreas|bladder|muscle|kidney)$/;

// One column's layers: where each ends, in mm below the skin: dermis, fat, fascia or sheath, three muscles, the zone of
// the ribs, the lining (its end is the wall's whole depth); which way each muscle's fibres run (rest space); what is in
// the ribs' zone there (0 intercostal muscle, 1 bone, 2 costal cartilage), and whether it is the belly.
type Column = { ends: number[]; fibres: BABYLON.Vector3[]; zone: number; belly: boolean };

export class Wall {
    declare mesh: BABYLON.Mesh;

    // Opening `o` (viscera.ts's: at, normal, ex, owner, half) of person `npc`, through the chest or the belly; `edge` the
    // skin's crossings all round its lips (viscera.ts's _lips), in order, a null where none was found.
    constructor(npc, o, edge: any[], chest: boolean, gape: (half: number[], x: number) => number) {
        const scene: BABYLON.Scene = npc.world.scene, person = npc.person;
        const ey = V3.Cross(o.normal, o.ex), into = npc.worldOf(o.at, o.owner, o.normal).normal.scale(-1);
        const n = edge.length;
        // Each column's top: where the skin's edge is, or (none found there) the lens on the opening's plane.
        const tops = edge.map((h, k) => {
            if (h) return h.rest.clone();
            const a = (k / n) * Math.PI * 2, x = Math.cos(a) * o.half[0];
            return o.at.add(o.ex.scale(x)).add(ey.scale(Math.sign(Math.sin(a)) * gape(o.half, x)));
        });
        const shoulder = (x: number) => person.byName[`upperarm01.${x > 0 ? 'R' : 'L'}`].head;
        const columns = tops.map((top) => this._column(npc, o.owner, top, into, chest, shoulder));

        // The ring's corners: down each column into the body along the opening's facing, the cut muscle drawn back across
        // the cut as far as its fibres cross it (cut across them it retracts; along them it hardly gapes: 2.1), the fat
        // bulging a little into the hole.
        const P: number[] = [], D: number[] = [], B0: number[] = [], B1: number[] = [], F1: number[] = [], F2: number[] = [], F3: number[] = [], Z: number[] = [];
        const down = o.normal.scale(-1);
        for (let k = 0; k < n; k++) {
            const c = columns[k], top = tops[k], deep = c.ends[7];
            const across = V3.Dot(top.subtract(o.at), ey);
            for (let r = 0; r < RINGS; r++) {
                const mm = -0.5 + (deep + 0.5) * (r / (RINGS - 1));
                const layer = c.ends.findIndex((e) => mm <= e);
                let widen = 0;
                if (layer >= 3 && layer <= 5) widen = 0.6 * Math.abs(V3.Dot(c.fibres[layer - 3], ey));
                else if (layer === 1) widen = -0.08 * Math.sin(Math.PI * Math.min(1, (mm - c.ends[0]) / Math.max(1, c.ends[1] - c.ends[0])));
                const p = top.add(down.scale(mm / 1000)).add(ey.scale(across * widen));
                P.push(p.x, p.y, p.z);
                D.push(mm);
                B0.push(c.ends[0], c.ends[1], c.ends[2], c.ends[3]);
                B1.push(c.ends[4], c.ends[5], c.ends[6], c.ends[7]);
                for (const [list, f] of [[F1, c.fibres[0]], [F2, c.fibres[1]], [F3, c.fibres[2]]] as [number[], BABYLON.Vector3][]) list.push(f.x, f.y, f.z);
                Z.push(c.zone + (c.belly ? 4 : 0));
            }
        }
        const I: number[] = [];
        for (let k = 0; k < n; k++) {
            const a = k * RINGS, b = ((k + 1) % n) * RINGS;
            for (let r = 0; r + 1 < RINGS; r++) I.push(a + r, b + r, a + r + 1, b + r, b + r + 1, a + r + 1);
        }
        const N: number[] = [];
        BABYLON.VertexData.ComputeNormals(P, I, N);
        // Facing into the hole, where it is seen from.
        const mid = new V3(), p0 = new V3(P[RINGS * 3], P[RINGS * 3 + 1], P[RINGS * 3 + 2]);
        for (let i = 0; i < P.length; i += 3) mid.addInPlaceFromFloats(P[i], P[i + 1], P[i + 2]);
        mid.scaleInPlace(3 / P.length);
        if (V3.Dot(new V3(N[RINGS * 3], N[RINGS * 3 + 1], N[RINGS * 3 + 2]), mid.subtract(p0)) < 0) for (let i = 0; i < N.length; i++) N[i] = -N[i];

        const mesh = new BABYLON.Mesh(`${person.mesh.name}_wall`, scene);
        const vd = new BABYLON.VertexData();
        const J = new Float32Array((P.length / 3) * 4), W = new Float32Array(J.length);
        for (let i = 0; i < J.length; i += 4) { J[i] = o.owner.index; W[i] = 1; }
        Object.assign(vd, { positions: new Float32Array(P), normals: new Float32Array(N), indices: new Uint32Array(I), matricesIndices: J, matricesWeights: W });
        vd.applyToMesh(mesh, false);
        mesh.setVerticesData('wallDepth', new Float32Array(D), false, 1);
        mesh.setVerticesData('wallEndsA', new Float32Array(B0), false, 4);
        mesh.setVerticesData('wallEndsB', new Float32Array(B1), false, 4);
        mesh.setVerticesData('wallFibre1', new Float32Array(F1), false, 3);
        mesh.setVerticesData('wallFibre2', new Float32Array(F2), false, 3);
        mesh.setVerticesData('wallFibre3', new Float32Array(F3), false, 3);
        mesh.setVerticesData('wallZone', new Float32Array(Z), false, 1);
        mesh.parent = person.mesh.parent;
        mesh.position.copyFrom(person.mesh.position);
        mesh.skeleton = person.skeleton;
        mesh.numBoneInfluencers = 1;
        mesh.alwaysSelectAsActiveMesh = true;
        mesh.isPickable = false;
        // (As the organs: the shadow maps are drawn from the whole skin and know nothing of the hole.)
        mesh.receiveShadows = false;
        mesh.material = material(scene);
        this.mesh = mesh;
    }

    // The layers under top (rest space) along `into` (world): measured to the ribs and the cavity, the soft layers laid in
    // at their thicknesses for the site, fat taking up the rest (it is what differs most between men).
    _column(npc, owner, top: BABYLON.Vector3, into: BABYLON.Vector3, chest: boolean, shoulder: (x: number) => BABYLON.Vector3): Column {
        const from = npc.worldOf(top, owner).at;
        const { spans } = npc.insides.trace(from, into, FAR, 0, (p) => CAVITY.test(p.kind) || /rib|sternum/.test(p.name));
        const organ = spans.find((s) => CAVITY.test(s.part.kind));
        const rib = spans.find((s) => /rib|sternum/.test(s.part.name) && (!organ || s.enter < organ.enter + 0.005));
        const x = top.x, medial = new V3(x > 0 ? -1 : 1, 0, 0);
        const zero = V3.Zero();
        if (chest) {
            let deep = organ ? organ.enter * 1000 : 42;
            if (rib) deep = Math.max(deep, rib.leave * 1000 + CHEST.lining);
            deep = Math.min(70, Math.max(18, deep));
            const zoneEnd = deep - CHEST.lining;
            const zoneStart = rib ? Math.max(DERMIS + 3, Math.min(rib.enter * 1000, zoneEnd - 4)) : Math.max(DERMIS + 3, zoneEnd - CHEST.space);
            const zone = rib ? (/sternum/.test(rib.part.name) || Math.abs(x) > CARTILAGE ? 1 : 2) : 0;
            const soft = zoneStart - DERMIS - CHEST.fascia;
            // Over the breastbone the pectorals thin to nothing at the midline.
            const pec = Math.abs(x) < PECTORAL;
            const [lo, hi] = pec ? CHEST.pec : CHEST.serratus;
            const muscle = Math.min(hi, Math.max(0, soft - 2), Math.max(lo, soft * 0.55)) * (pec ? Math.min(1, Math.abs(x) / 0.04) : 1);
            const fat = soft - muscle;
            const e1 = DERMIS + fat, e2 = e1 + CHEST.fascia, e3 = e2 + muscle;
            // Pectoralis major's fibres converge on the arm; serratus anterior's run back round the chest to the scapula.
            const fibre = pec ? shoulder(x).subtract(top).normalize() : new V3(0, 0.2, -1).normalize();
            return { ends: [DERMIS, e1, e2, e3, e3, e3, zoneEnd, deep], fibres: [fibre, zero, zero], zone, belly: false };
        }
        const deep = Math.min(60, Math.max(22, organ ? organ.enter * 1000 : 34));
        const b = BELLY, linea = Math.abs(x) < LINEA, rectus = Math.abs(x) < RECTUS;
        const sheath = linea ? b.linea : rectus ? b.sheath : 0.5;
        let m = linea ? [0, 0, 0] : rectus ? [b.rectus, 0, 0] : [b.eo, b.io, b.ta];
        // Fat at least 4 mm; a wall thinner than the muscles' sum has thinner muscles (a smaller man), not none.
        const room = deep - DERMIS - sheath - b.lining - 4, sum = m[0] + m[1] + m[2];
        if (sum > room) m = m.map((t) => (t * Math.max(0, room)) / sum);
        const fat = deep - DERMIS - sheath - b.lining - m[0] - m[1] - m[2];
        const e1 = DERMIS + fat, e2 = e1 + sheath, e3 = e2 + m[0], e4 = e3 + m[1], e5 = e4 + m[2];
        // Rectus vertical; external oblique down and in, internal oblique up and in, transversus across (1.5).
        const fibres = rectus ? [V3.Up(), zero, zero] : [medial.scale(0.6).add(V3.Down().scale(0.8)), medial.scale(0.6).add(V3.Up().scale(0.8)), medial];
        return { ends: [DERMIS, e1, e2, e3, e4, e5, e5, deep], fibres, zone: 0, belly: true };
    }

    dispose() { this.mesh?.dispose(); }
}

// --- the look of the cut wall ------------------------------------------------------------------------------------
//
// Colours from body-wall.md 1.6 and marks.ts's lips (the same fat, sheath and muscle, so the face continues the band
// painted on the skin round it): the dermis a pale pinkish rim; fat pale cream to light yellow in bulging lobules;
// fascia and sheaths thin silky white; muscle dark red with its grain; rib in section an ivory cortex round dark red
// marrow; costal cartilage bluish white and glossy; the pleura a glistening film, the belly's lining yellow
// extraperitoneal fat and then the peritoneum. Blood over all of it, most in the muscle and toward the bottom.

const GLSL_WALL = `
float wallHash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }
float wallNoise(vec3 p) {
    vec3 i = floor(p), f = fract(p);
    f = f * f * (3.0 - 2.0 * f);
    return mix(mix(mix(wallHash(i), wallHash(i + vec3(1, 0, 0)), f.x), mix(wallHash(i + vec3(0, 1, 0)), wallHash(i + vec3(1, 1, 0)), f.x), f.y),
               mix(mix(wallHash(i + vec3(0, 0, 1)), wallHash(i + vec3(1, 0, 1)), f.x), mix(wallHash(i + vec3(0, 1, 1)), wallHash(i + vec3(1, 1, 1)), f.x), f.y), f.z);
}
// Muscle's grain at p for fibres along f: fascicles a millimetre or two across and centimetres long, paler connective
// tissue between them. Seen across the fibres it is a stipple of ends; along them, stripes.
float wallGrain(vec3 p, vec3 f, float px) {
    f = normalize(f + vec3(1e-4));
    vec3 a = normalize(cross(f, abs(f.y) < 0.9 ? vec3(0.0, 1.0, 0.0) : vec3(1.0, 0.0, 0.0))), b = cross(f, a);
    vec3 q = vec3(dot(p, f) * 45.0, dot(p, a) * 650.0, dot(p, b) * 650.0);
    float fine = clamp(1.0 / (650.0 * px) - 1.0, 0.0, 1.0);
    float n = wallNoise(q), m = wallNoise(q * vec3(0.5, 0.33, 0.33) + 7.0);
    float seam = 1.0 - smoothstep(0.0, 0.18, abs(n - 0.5));
    return mix(0.5, n * 0.6 + m * 0.4, fine) - 0.35 * seam * fine;
}
`;

class Layers extends BABYLON.MaterialPluginBase {
    constructor(material) {
        super(material, 'Layers', 222, { BODYWALL: false });
        this._enable(true);
    }

    getClassName() { return 'Layers'; }

    prepareDefines(defines) { defines.BODYWALL = true; }

    getAttributes(attributes) { attributes.push('wallDepth', 'wallEndsA', 'wallEndsB', 'wallFibre1', 'wallFibre2', 'wallFibre3', 'wallZone'); }

    getCustomCode(shaderType) {
        if (shaderType === 'vertex') {
            return {
                CUSTOM_VERTEX_DEFINITIONS: `#ifdef BODYWALL
attribute float wallDepth; attribute vec4 wallEndsA; attribute vec4 wallEndsB; attribute vec3 wallFibre1; attribute vec3 wallFibre2; attribute vec3 wallFibre3; attribute float wallZone;
varying vec3 vWallRest; varying float vWallD; varying vec4 vWallA; varying vec4 vWallB; varying vec3 vWallF1; varying vec3 vWallF2; varying vec3 vWallF3; varying float vWallZone;
#endif
`,
                CUSTOM_VERTEX_MAIN_BEGIN: `#ifdef BODYWALL
vWallRest = position; vWallD = wallDepth; vWallA = wallEndsA; vWallB = wallEndsB; vWallF1 = wallFibre1; vWallF2 = wallFibre2; vWallF3 = wallFibre3; vWallZone = wallZone;
#endif
`,
            };
        }
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef BODYWALL
varying vec3 vWallRest; varying float vWallD; varying vec4 vWallA; varying vec4 vWallB; varying vec3 vWallF1; varying vec3 vWallF2; varying vec3 vWallF3; varying float vWallZone;
${GLSL_WALL}${GLSL_BLOOD}#endif
`,
            CUSTOM_FRAGMENT_UPDATE_ALPHA: `
float wallGloss = 0.0;
#ifdef BODYWALL
{
    vec3 p = vWallRest;
    float px = max(length(dFdx(p)), length(dFdy(p)));
    #define wallFade(f) clamp(1.0 / ((f) * px) - 1.0, 0.0, 1.0)
    // Each boundary wanders by a millimetre or two along the face, as real layers do.
    float d = vWallD + ((wallNoise(p * 160.0) - 0.5) * 2.4 + (mix(0.5, wallNoise(p * 650.0), wallFade(650.0)) - 0.5) * 0.6) * clamp(vWallD / 3.0, 0.0, 1.0);
    float deep = vWallB.w;
    bool belly = vWallZone > 3.5;
    float zone = vWallZone - (belly ? 4.0 : 0.0);
    // Layers, outside in: dermis, fat, fascia/sheath, muscle 1-3, the ribs' zone, the lining.
    vec3 c;
    float gloss = 0.35, lift = 0.0, oozes = 0.0;
    vec3 fatC = mix(vec3(0.82, 0.70, 0.48), vec3(0.93, 0.86, 0.66), smoothstep(0.3, 0.7, mix(0.5, wallNoise(p * 300.0 + 5.0) * 0.65 + wallNoise(p * 800.0 + 9.0) * 0.35, wallFade(800.0))));
    float lob = mix(0.5, wallNoise(p * 300.0 + 5.0), wallFade(300.0));
    if (d < vWallA.x) {
        // The skin's cut edge: the thin darker epidermis on top, then the dense pale dermis.
        c = mix(vec3(0.55, 0.36, 0.30), vec3(0.84, 0.66, 0.60), smoothstep(0.1, 0.6, d));
        gloss = 0.3;
    } else if (d < vWallA.y) {
        c = fatC;
        // The septa between lobules, thin and white; the lobules stand out and catch the light.
        c = mix(c, vec3(0.9, 0.86, 0.8), (1.0 - smoothstep(0.0, 0.06, abs(lob - 0.5))) * 0.5 * wallFade(300.0));
        lift = lob * 0.0012;
        gloss = 0.55;
    } else if (d < vWallA.z) {
        c = vec3(0.80, 0.77, 0.72) * (0.92 + 0.12 * mix(0.5, wallNoise(p * vec3(900.0, 120.0, 900.0)), wallFade(900.0)));
        gloss = 0.7;
    } else if (d < vWallB.z) {
        vec3 f = d < vWallA.w ? vWallF1 : d < vWallB.x ? vWallF2 : d < vWallB.y ? vWallF3 : vec3(0.0);
        bool ribs = d >= vWallB.y;
        if (ribs && zone > 0.5) {
            // A rib or the breastbone in section: a thin ivory cortex round dark red marrow; the front of a rib cartilage.
            float edge = min(d - vWallB.y, vWallB.z - d);
            vec3 marrow = mix(vec3(0.40, 0.08, 0.06), vec3(0.58, 0.20, 0.13), mix(0.5, wallNoise(p * 900.0), wallFade(900.0)));
            c = zone > 1.5 ? vec3(0.80, 0.83, 0.86) * (0.95 + 0.08 * wallNoise(p * 200.0)) : mix(vec3(0.86, 0.82, 0.70), marrow, smoothstep(1.2, 2.0, edge));
            gloss = zone > 1.5 ? 0.8 : 0.45;
        } else {
            // The intercostals run down and forward (the external) and down and back (the internal) between the ribs.
            if (ribs) f = normalize(vec3(p.x > 0.0 ? -0.5 : 0.5, -0.85, 0.15));
            float g = wallGrain(p, f, px);
            c = mix(vec3(0.30, 0.05, 0.04), vec3(0.52, 0.12, 0.09), g);
            if (ribs) c *= 0.85;
            gloss = 0.5;
            oozes = 1.0;
        }
        // The thin white fascia between one muscle and the next.
        float seam = min(min(abs(d - vWallA.w), abs(d - vWallB.x)), abs(d - vWallB.y));
        c = mix(c, vec3(0.78, 0.74, 0.68), (1.0 - smoothstep(0.15, 0.45, seam)) * 0.7);
    } else {
        // The lining: in the chest the endothoracic fascia and the parietal pleura, a glistening film; in the belly
        // yellow extraperitoneal fat, then the peritoneum.
        float t = (d - vWallB.z) / max(0.3, deep - vWallB.z);
        c = belly ? mix(fatC * vec3(1.0, 0.95, 0.8), vec3(0.80, 0.70, 0.68), smoothstep(0.6, 0.9, t)) : vec3(0.78, 0.64, 0.62);
        gloss = 0.85;
    }
    vec3 wall = toLinearSpace(c);
    // Blood: a film over all of it, thick in the muscle and pooling toward the bottom, thin on the fat in patches.
    float blotch = mix(0.5, wallNoise(p * 110.0 + 3.0), wallFade(110.0));
    // (Millimetres of blood: a tenth of one is already nearly opaque red (fluid.ts), so the film is thin where the layers
    // must still read, and thick only where it collects at the bottom.)
    float mm = 0.006 + 0.035 * oozes * (0.3 + blotch) + 0.3 * smoothstep(0.75, 1.0, vWallD / max(deep, 1.0)) * blotch + (1.0 - smoothstep(0.25, 0.42, lob)) * 0.05 * step(vWallA.x, d) * step(d, vWallA.y);
    surfaceAlbedo = bloodOver(wall, mm, 1.0);
    wallGloss = mix(gloss, 0.75, clamp(mm * 10.0, 0.0, 1.0));
    // The lobules and fascicles stand out of the face a little (in metres): the light catches them.
    float h = lift + (oozes > 0.5 ? 0.0004 * mix(0.5, wallNoise(p * 650.0), wallFade(650.0)) : 0.0);
    vec3 dpx = dFdx(vPositionW), dpy = dFdy(vPositionW);
    float dhx = dFdx(h), dhy = dFdy(h);
    vec3 r1v = cross(dpy, normalW), r2v = cross(normalW, dpx);
    float det = dot(dpx, r1v);
    normalW = normalize(abs(det) * normalW - sign(det) * (dhx * r1v + dhy * r2v));
}
#endif
`,
            '!(float roughness=reflectivityOut\\.roughness;)': `$1
#ifdef BODYWALL
microSurface = wallGloss;
roughness = 1.0 - microSurface;
#endif
`,
        };
    }
}

// (One for everybody's openings: what differs is in the corners.)
function material(scene: BABYLON.Scene) {
    const old = scene.getMaterialByName('body_wall');
    if (old) return old;
    const m = new BABYLON.PBRMaterial('body_wall', scene);
    m.albedoColor = BABYLON.Color3.White();
    m.metallic = 0;
    m.roughness = 0.5;
    m.backFaceCulling = false;
    m.twoSidedLighting = true;
    m.reflectionTexture = (scene.getMaterialByName('dropBlood') as BABYLON.PBRMaterial)?.reflectionTexture ?? null;
    m.environmentIntensity = 0.3;
    m.maxSimultaneousLights = 8;
    new Layers(m);
    return m;
}
