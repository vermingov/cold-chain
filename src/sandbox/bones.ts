// A person's bones: how strong each one is, what breaks it and how it breaks,
// and what the break then does to the body, inside and out.
//
// A bone is broken by force, not by a store of energy: a blow, a fall onto
// the floor, a joint wrenched past its range. The force a blow makes is the
// one a spring of flesh over the bone makes when something of mass m hits it
// at v, F = v sqrt(k m) (Robinovitch, Hayes and McMahon 1991, for a fall on
// the hip): a bat on a shin, with a few millimetres of skin over the bone, makes
// three times the force it makes on a thigh. That force against the bone's own
// strength (BONES, a young man's, laboratory figures) scaled by this person's
// age and build says whether it breaks; how far over says how badly, and the
// way it was loaded says how it breaks: bent, it breaks across (transverse),
// then with a wedge knocked out of it (butterfly), then in pieces (comminuted);
// twisted, it breaks in a spiral; crushed along its length, a vertebra is
// squashed (compression) or bursts. A blow that does not break a bone still
// cracks it a little, and the next one breaks it sooner.
//
// A bullet is different: what decides is its energy per square millimetre of its
// face when it reaches the bone, and the break follows the wounding literature
// (Bartlett et al. 2000): a drill hole through the soft ends of a long bone, a
// shattered shaft, and from a rifle a shaft blown to pieces that go on through
// the flesh as missiles of their own (wounds.ts's shards).
//
// What a break does: a broken shaft lets the limb bend and turn at the break
// (ragdoll.ts's mid joint, here given the range the kind of break allows); a
// break at a bone's end loosens the joint there; a femur or tibia will not
// carry weight; ribs make breathing hurt and a flail segment stops a lung
// filling; a broken neck or back can cut the cord; a skull fracture bruises the
// brain, and one over the temple tears the artery under it and bleeds into the
// skull until the brain is crushed. A closed fracture bleeds into the limb what
// ATLS says it does. A shaft bent far enough at the break drives the bone's end
// out through the skin (an open fracture), drawn with the bone's own shape.

import * as BABYLON from '@babylonjs/core';
import { midOf } from './ragdoll.ts';
import { region, crack, bone, jag, type Cut, type Tri } from './shards.ts';
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion;
const AXIS = BABYLON.PhysicsConstraintAxis, LIMIT = BABYLON.PhysicsConstraintAxisLimitMode;
const ANGULAR = [AXIS.ANGULAR_X, AXIS.ANGULAR_Y, AXIS.ANGULAR_Z];

// Each bone by its name (side left off): its strength in a young adult man, and what lies over it.
//   bend    N across it before it breaks (three-point bending, at speed)
//   twist   N m about its length before it breaks in a spiral
//   ends    N on its spongy ends (the femur's neck in a fall on the hip, the radius's in a fall on the hand)
//   axial   N along it (vertebrae, the heel)
//   pad     N/m: how stiff the flesh over it is (the spring in F = v sqrt(k m))
//   wide    m: how thick it is where a bullet crosses it (a shaft across, a flat bone through)
//   blood   litres a closed fracture of it bleeds into the tissues (ATLS: femur 1-1.5, tibia 0.75, humerus 0.5-0.75,
//           pelvis 1.5-3, a rib 0.1-0.15)
//   open    degrees the shaft must bend at the break before its end comes through the skin: the shin's front has
//           nothing over it but skin, the thigh has the whole quadriceps (none for the fibula, deep in the calf's muscle)
//   long    [its first bone, the bone at its far end, the ragdoll segment it is in]
// Sources: femur and tibia bending, Kerrigan et al. 2004 and Nyquist et al. 1985; torsion, Martens et al. 1980 (femur)
// and ski-binding release data (tibia, ISO 11088); femoral neck in a sideways fall, Courtney et al. 1995 (7.2 kN young,
// 3.4 kN old); skull, Yoganandan et al. 1995 (4.5-14 kN); mandible, Nahum 1975; lumbar and thoracic bodies, Brinckmann
// et al. 1989; the trochanter's 71 kN/m, Robinovitch et al. 1991. The arm's figures, the clavicle's and the pelvis's
// are from cadaver series without one clean number and are rounded to the middle of what is reported.
type Bone = { bend: number; twist?: number; ends?: number; axial?: number; pad: number; wide?: number; blood: number; open?: number; long?: [string, string, string]; pain: number };
const BONES: Record<string, Bone> = {
    femur: { bend: 4500, twist: 180, ends: 7000, pad: 40e3, wide: 0.028, blood: 1.25, open: 55, long: ['upperleg01', 'lowerleg01', 'thigh'], pain: 0.6 },
    tibia: { bend: 3500, twist: 95, ends: 5000, axial: 9000, pad: 300e3, wide: 0.024, blood: 0.75, open: 25, long: ['lowerleg01', 'foot', 'shin'], pain: 0.55 },
    fibula: { bend: 700, twist: 25, ends: 2000, pad: 100e3, wide: 0.012, blood: 0.1, long: ['lowerleg01', 'foot', 'shin'], pain: 0.3 },
    humerus: { bend: 2500, twist: 70, ends: 3000, pad: 80e3, wide: 0.022, blood: 0.6, open: 45, long: ['upperarm01', 'lowerarm01', 'upperarm'], pain: 0.5 },
    radius: { bend: 1300, twist: 20, ends: 3800, pad: 150e3, wide: 0.015, blood: 0.25, open: 30, long: ['lowerarm01', 'wrist', 'forearm'], pain: 0.45 },
    ulna: { bend: 1500, twist: 20, ends: 2500, pad: 300e3, wide: 0.014, blood: 0.25, open: 30, long: ['lowerarm01', 'wrist', 'forearm'], pain: 0.45 },
    clavicle: { bend: 1100, axial: 2500, wide: 0.012, pad: 300e3, blood: 0.1, pain: 0.45 },
    scapula: { bend: 3500, wide: 0.006, pad: 40e3, blood: 0.3, pain: 0.4 },
    ribs: { bend: 2500, wide: 0.01, pad: 100e3, blood: 0.12, pain: 0.45 },
    sternum: { bend: 4000, wide: 0.012, pad: 300e3, blood: 0.15, pain: 0.45 },
    skull: { bend: 6000, wide: 0.008, pad: 500e3, blood: 0, pain: 0.4 },
    jaw: { bend: 2500, wide: 0.012, pad: 400e3, blood: 0.05, pain: 0.5 },
    'neck spine': { bend: 3000, axial: 3200, wide: 0.02, pad: 100e3, blood: 0.1, pain: 0.5 },
    'upper thoracic spine': { bend: 4000, axial: 4500, wide: 0.03, pad: 150e3, blood: 0.2, pain: 0.5 },
    'lower thoracic spine': { bend: 4000, axial: 5000, wide: 0.03, pad: 150e3, blood: 0.2, pain: 0.5 },
    'lumbar spine': { bend: 5000, axial: 6000, wide: 0.035, pad: 150e3, blood: 0.3, pain: 0.55 },
    sacrum: { bend: 5000, axial: 5000, wide: 0.03, pad: 70e3, blood: 0.5, pain: 0.55 },
    'hip bone': { bend: 8000, wide: 0.015, pad: 70e3, blood: 1.5, pain: 0.65 },
    kneecap: { bend: 8000, wide: 0.02, pad: 150e3, blood: 0.05, pain: 0.45 },
    'hand bones': { bend: 800, wide: 0.01, pad: 200e3, blood: 0.03, pain: 0.35 },
    'foot bones': { bend: 1500, axial: 5000, wide: 0.015, pad: 200e3, blood: 0.1, pain: 0.4 },
};
// A long bone's ends: what a break there is called, and the joint it loosens (the ragdoll segment below the joint).
const ENDS: Record<string, [string, string | null][]> = {
    femur: [['neck (the hip)', 'thigh'], ['lower end, above the knee', 'shin']],
    tibia: [['top, into the knee', 'shin'], ['lower end, into the ankle', 'foot']],
    fibula: [['head, below the knee', null], ['lower end, at the ankle', 'foot']],
    humerus: [['neck, at the shoulder', 'upperarm'], ['lower end, above the elbow', 'forearm']],
    radius: [['head, at the elbow', 'forearm'], ['lower end, at the wrist', 'hand']],
    ulna: [['top, at the elbow', 'forearm'], ['lower end, at the wrist', 'hand']],
};
const WORDS = { transverse: 'transverse fracture', oblique: 'oblique fracture', spiral: 'spiral fracture', butterfly: 'fracture with a butterfly fragment',
    comminuted: 'comminuted fracture', 'drill hole': 'bullet hole through the bone', gutter: 'gouged by the bullet', linear: 'linear fracture',
    depressed: 'depressed fracture, pushed in on the brain', basilar: 'basilar fracture', compression: 'compression fracture', burst: 'burst fracture', simple: 'fracture' };
// How far a broken shaft can now bend at the break (hinge, twist, side; radians), by how it broke: a transverse break
// keeps a hinge of periosteum and its ends catch on each other; a shattered one is held only by the muscle and skin
// round it.
const GIVE = { transverse: [0.6, 0.2, 0.6], oblique: [0.7, 0.3, 0.7], spiral: [0.5, 0.8, 0.5], butterfly: [0.8, 0.4, 0.8], comminuted: [1, 0.6, 1] };
// The bone that shares a limb segment with each, and breaks with it when it is displaced.
const PARTNER = { tibia: 'fibula', radius: 'ulna', ulna: 'radius' };
// Metres the two halves can slide past each other: the thigh's muscles pull an oblique or shattered femur short.
const SHORTEN = { transverse: 0.004, oblique: 0.02, spiral: 0.015, butterfly: 0.02, comminuted: 0.03 };
const UNSTABLE = new Set(Object.keys(GIVE));

// What gives when a joint is bent the way it does not bend, by a blow landing at it: at what torque (N m, a young
// adult's) and how. Knee: Kajzer et al. 1999 (about 140 N m sideways); the rest are estimates from injury series, as
// there are no clean figures for a living joint with its muscles round it.
const JOINTS = {
    upperarm: { name: 'shoulder', holds: 70, gives: 'dislocated' },
    forearm: { name: 'elbow', holds: 45, gives: 'dislocated' },
    hand: { name: 'wrist', holds: 50, gives: 'wrist' },
    shin: { name: 'knee', holds: 140, gives: 'torn' },
    foot: { name: 'ankle', holds: 60, gives: 'torn' },
};
// Where a dislocated joint is held (hinge, twist, side; degrees, as the pose controls count them); none for a knee,
// which once out holds nowhere.
const OUT = { upperarm: [25, 35, 30], forearm: [45, 0, 0] };
const LEVER = 0.04;             // m: how far from a joint a blow's force acts on it, the limb's own inertia taking the rest
// The share of a person's weight that comes down with each part that breaks a fall, when it hits the floor: the hip
// carries about half the body into it in a fall on the side (Robinovitch et al. 1991), an outstretched hand a few per
// cent, the elbow giving (Chiu and Robinovitch 1998). A forearm or a thigh landing flat spreads its load over its flesh
// and breaks nothing at the heights a body falls from here.
const LANDING = { head: 0.06, chest: 0.3, pelvis: 0.45, upperarm: 0.2, hand: 0.05, shin: 0.12, foot: 0.5 };
const STRUCK = { head: 0.08, chest: 0.3, belly: 0.2, pelvis: 0.4, upperarm: 0.04, upperarm2: 0.035, forearm: 0.022, forearm2: 0.022, hand: 0.008,
    thigh: 0.15, thigh2: 0.12, shin: 0.06, shin2: 0.05, foot: 0.02 };
// The bone a blow to each segment lands on when the line it came along misses every bone.
const UNDER = { head: 'skull', chest: 'ribs', belly: 'lower thoracic spine', pelvis: 'hip bone', upperarm: 'humerus', forearm: 'ulna', hand: 'hand bones',
    thigh: 'femur', shin: 'tibia', foot: 'foot bones' };

const HARD = 5e6;               // N/m: a bat, a toolbox, a floor; next to flesh, as good as rigid
const PERFORATE = 0.2;          // J/mm2 of a bullet's face to break through bone: twice skin's 0.1 (Sellier and Kneubuehl)
const CLOT = 0.002;             // how fast a fracture's bleeding slows: what it loses in all is its rate over this
const FLOOR = 0;
const RAD = Math.PI / 180;

export type Break = {
    part: string; key: string; side: 'L' | 'R' | ''; type: string; how: string; ratio: number; where: string; end: number; s: number; hit: number;
    at: BABYLON.Vector3; dir: BABYLON.Vector3; owner: any; open: boolean; seg: any; count: number; level: string; text: string;
    cut?: Cut; through?: boolean; wound?: any; out?: BABYLON.Vector3; tris?: (Tri & { bare?: boolean })[]; lines?: [Cut, (p: BABYLON.Vector3) => boolean][]; meshes?: BABYLON.Mesh[];
};

const keyOf = (name: string) => name.replace(/^(left|right) /, '');
const sideOf = (name: string): 'L' | 'R' | '' => (/^left/.test(name) ? 'L' : /^right/.test(name) ? 'R' : '');
const wordOf = (side) => (side === 'L' ? 'left' : 'right');
const cap = (s: string) => s[0].toUpperCase() + s.slice(1);
const clamp = (x, lo, hi) => Math.max(lo, Math.min(hi, x));
// Age from MakeHuman's slider (person.ts's people are MakeHuman's): 0.5 is 25 years, 1 is 90.
const yearsOf = (slider: number) => (slider < 0.5 ? 1 + slider * 48 : 25 + (slider - 0.5) * 130);
// Some direction square to unit `u`, toward `hint` if it can be.
const across = (u: BABYLON.Vector3, hint: BABYLON.Vector3) => {
    let d = hint.subtract(u.scale(V3.Dot(hint, u)));
    if (d.lengthSquared() < 1e-6) d = V3.Cross(u, Math.abs(u.y) < 0.9 ? V3.Up() : V3.Right());
    return d.normalize();
};

const _v = new V3(), _w = new V3();

export class Bones {
    declare npc: any;
    declare age: number;
    declare cortical: number;
    declare spongy: number;
    declare build: number;
    declare grain: Map<string, number>;
    declare damage: Map<string, number>;
    declare breaks: Break[];
    declare joints: Map<string, string>;
    declare epidural: any;
    declare meshes: BABYLON.Mesh[];
    declare _vy: Map<any, number>;
    declare _born: number;
    declare _observer: BABYLON.Observer<BABYLON.Scene>;

    constructor(npc) {
        this.npc = npc;
        const spec = npc.person.header.spec ?? { age: 0.5 };
        this.age = yearsOf(spec.age);
        // Cortical bone (the shafts) loses about 6% of its strength a decade after thirty, the spongy bone of the hip,
        // the wrist and the vertebrae about twice that (McCalden et al. 1993; Courtney et al. 1995).
        this.cortical = clamp(1 - 0.006 * (this.age - 30), 0.6, 1);
        this.spongy = clamp(1 - 0.012 * (this.age - 30), 0.4, 1);
        this.build = Math.pow(npc.ragdoll.mass / 75, 2 / 3);
        // Two men of one age and size still differ, bone by bone, by a tenth or so.
        this.grain = new Map(Object.keys(BONES).flatMap((k) => ['left ', 'right ', ''].map((s) => [s + k, 0.9 + Math.random() * 0.2])));
        this.damage = new Map();
        this.breaks = [];
        this.joints = new Map();
        this.meshes = [];
        this.epidural = null;
        this._vy = new Map();
        this._born = npc.world.frame;
        this._observer = npc.world.scene.onAfterPhysicsObservable.add(() => this.update());
    }

    // --- strength --------------------------------------------------------------------------

    // What bone `name` takes now in one way of loading it: 'bend', 'twist', 'ends' or 'axial'.
    strength(name: string, way: 'bend' | 'twist' | 'ends' | 'axial') {
        const b = BONES[keyOf(name)];
        const base = b[way] ?? b.bend;
        const spongy = way === 'ends' || way === 'axial' || /spine|sacrum|kneecap/.test(name);
        const cracked = 1 - 0.5 * (this.damage.get(name) ?? 0);
        return base * (spongy ? this.spongy : this.cortical) * this.build * (this.grain.get(name) ?? 1) * cracked;
    }

    // A load on bone `name`, `how` it came ('blow', 'fall', 'wrench'): `force` N across it, `twist` N m about it, `axial`
    // N along it, at `at` (world) going `dir`; `end` 0 or 1 for a load on a long bone's end (a fall on the hip or the
    // hand). Breaks it if it is more than the bone takes, and cracks it a little if it comes near. The break, or null.
    load(name: string, how: string, { force = 0, twist = 0, axial = 0, at = null, dir = null, end = -1 }: { force?: number; twist?: number; axial?: number; at?: BABYLON.Vector3; dir?: BABYLON.Vector3; end?: number }) {
        const key = keyOf(name), b = BONES[key];
        if (!b || !this.npc.insides.parts.some((p) => p.name === name)) return null;
        const ways: [string, number][] = [['bend', force / this.strength(name, end >= 0 ? 'ends' : 'bend')], ['twist', twist / this.strength(name, 'twist')],
            ['axial', axial / this.strength(name, 'axial')]];
        const [way, ratio] = ways.reduce((a, w) => (w[1] > a[1] ? w : a));
        if (ratio < 1) {
            // Miner's rule, roughly: a load at half the strength does a little harm, one near it a lot.
            if (ratio > 0.5) this.damage.set(name, Math.min(0.9, (this.damage.get(name) ?? 0) + 0.25 * ratio ** 4));
            return null;
        }
        const rest = this._rest(name, at, dir, end);
        let type = 'simple';
        // (A long bone's spongy end crumples rather than snapping: a fracture there, or one in pieces.)
        if (b.long && rest.end >= 0) type = ratio < 2 ? 'simple' : 'comminuted';
        else if (b.long) type = way === 'twist' ? 'spiral' : way === 'axial' ? 'oblique' : ratio < 1.4 ? (how === 'fall' ? 'oblique' : 'transverse') : ratio < 2.2 ? 'butterfly' : 'comminuted';
        else if (key === 'skull') type = rest.base ? 'basilar' : how === 'blow' && ratio > 1.8 ? 'depressed' : 'linear';
        else if (/spine|sacrum/.test(key) && way === 'axial') type = ratio < 1.5 ? 'compression' : 'burst';
        else if (ratio > 2.2) type = 'comminuted';
        return this._break(name, type, how, ratio, rest);
    }

    // Something of `mass` kg at `speed` m/s along `dir` into segment `seg` at `point` (world), its own stiffness
    // `stiffness` N/m: the force on the first bone in its way, which takes it as load() says. Returns the force.
    impact(seg, point: BABYLON.Vector3, dir: BABYLON.Vector3, mass: number, speed: number, stiffness = HARD) {
        const base = seg.name.replace(/[LR]$/, '');
        const behind = this.npc.ragdoll.mass * (STRUCK[base] ?? 0.05);
        const m = (mass * behind) / (mass + behind);
        const bone = this._struck(seg, point, dir);
        if (!bone) return 0;
        const k = 1 / (1 / BONES[keyOf(bone.name)].pad + 1 / stiffness);
        const force = speed * Math.sqrt(k * m);
        if (!this.load(bone.name, 'blow', { force, at: bone.at, dir })) this._atJoint(point, dir, force);
        return force;
    }

    // A bullet into bone `part` (an Insides part) at `at` (world) along `dir`, with `energy` J left, `calibre` m across,
    // its path running `through` m inside the bone. How many pieces of bone it drives on, and the break if it broke.
    shot(part, at: BABYLON.Vector3, dir: BABYLON.Vector3, energy: number, calibre: number, through: number) {
        const name = part.name, key = keyOf(name), b = BONES[key];
        if (!b) return { pieces: 0, br: null };
        const density = energy / (Math.PI * (calibre * 500) ** 2);
        if (density < PERFORATE * this.cortical) {
            this.damage.set(name, Math.min(0.9, (this.damage.get(name) ?? 0) + 0.3));
            this.npc.vitals.injure(`Bullet chipped the ${name}`, 3);
            return { pieces: 0, br: null };
        }
        const rest = this._rest(name, at, dir);
        let type: string;
        if (b.long && through < (b.wide ?? 0.02) * 0.35) type = 'gutter';
        else if (b.long && rest.end >= 0) type = energy < 1000 ? 'drill hole' : 'comminuted';
        else if (b.long) type = energy < 400 ? 'butterfly' : 'comminuted';
        else type = energy < 400 && key !== 'skull' ? 'simple' : 'comminuted';
        const br = this._break(name, type, 'shot', density / PERFORATE, rest, calibre);
        const pieces = type === 'comminuted' ? (energy > 1500 ? 6 : 3) : type === 'butterfly' ? 1 : 0;
        return { pieces, br };
    }

    // How much bone a bullet crossing bone `name` goes through, m.
    thickness(name: string) { return BONES[keyOf(name)]?.wide ?? 0.015; }

    // Whether bone `name` is broken (in its `where`, if given).
    broken(name: string, where = '') { return this.breaks.some((b) => b.part === name && (!where || b.where === where)); }

    // --- where on a bone ------------------------------------------------------------------------

    // A long bone's line in rest space: from its first joint `a`, along unit `u`, `length` long; and the bones that carry
    // its near and far halves.
    _axis(name: string) {
        const b = BONES[keyOf(name)], side = sideOf(name), { byName } = this.npc.person;
        const [first, next] = b.long;
        const a = byName[`${first}.${side}`].head, z = byName[`${next}.${side}`].head;
        const d = z.subtract(a);
        return { a, u: d.normalizeToNew(), length: d.length(), near: byName[`${first}.${side}`], far: byName[midOf(first, side)] };
    }

    // Where on bone `name` a world point `at` (and a direction `dir`) is, in the person's rest space; for a long bone
    // also how far along it (0 to 1), and which end it is near (-1 for the shaft); for the skull whether it is its base.
    // With no point, the middle of the bone (or of its end `end`).
    _rest(name: string, at: BABYLON.Vector3 | null, dir: BABYLON.Vector3 | null, end = -1) {
        const npc = this.npc, b = BONES[keyOf(name)];
        npc.person.skeleton.computeAbsoluteMatrices(true);
        const entries = npc.insides.parts.filter((p) => p.name === name);
        const toRest = (owner) => npc.restToWorld(owner).clone().invert();
        // (A part carried by more than one bone, the skull with its base on the neck, is read in the frame of the bone that
        // carries most of it.)
        const size = (e) => e.clusters.reduce((n, c) => n + c.tris.length, 0);
        let owner = entries.reduce((a, e) => (size(e) > size(a) ? e : a)).owner, p: BABYLON.Vector3, d: BABYLON.Vector3;
        if (b.long) {
            const ax = this._axis(name);
            let s = end === 0 ? 0.08 : end === 1 ? 0.92 : 0.5;
            if (at && end < 0) {
                // Read in the near half's frame, and if that puts it past the middle, in the far half's: once the bone has
                // broken the two frames no longer agree.
                const along = (half) => { p = V3.TransformCoordinates(at, toRest(half)); return V3.Dot(p.subtract(ax.a), ax.u) / ax.length; };
                s = along(ax.near);
                if (s > 0.5) s = Math.max(0.5, along(ax.far));
                s = clamp(s, 0.02, 0.98);
            }
            p = p ?? ax.a.add(ax.u.scale(s * ax.length));
            owner = s <= 0.5 ? ax.near : ax.far;
            d = dir ? V3.TransformNormal(dir, toRest(owner)).normalize() : across(ax.u, new V3(0, 0, 1));
            return { p, d, owner, s, end: end >= 0 ? end : s < 0.2 ? 0 : s > 0.8 ? 1 : -1, base: false };
        }
        const centre = V3.FromArray(entries[0].source.centre);
        p = at ? V3.TransformCoordinates(at, toRest(owner)) : centre;
        d = dir ? V3.TransformNormal(dir, toRest(owner)).normalize() : new V3(0, -1, 0);
        // The skull's base: below the ears and toward the back, where a fall on the back of the head lands.
        const base = keyOf(name) === 'skull' && p.y < centre.y - 0.035;
        return { p, d, owner, s: 0.5, end: -1, base };
    }

    // The first bone in a blow's way into segment `seg` at `point` along `dir`, or the bone under that segment.
    _struck(seg, point: BABYLON.Vector3, dir: BABYLON.Vector3) {
        const { spans } = this.npc.insides.trace(point.subtract(dir.scale(0.15)), dir, 0.45, 0, (p) => p.kind === 'bone' || p.kind === 'skull');
        const first = spans[0];
        if (first) return { name: first.part.name, at: point.subtract(dir.scale(0.15)).add(dir.scale(first.enter)) };
        const under = UNDER[seg.name.replace(/2?[LR]$/, '')];
        if (!under) return null;
        const side = seg.name.endsWith('L') ? 'left ' : seg.name.endsWith('R') ? 'right ' : /ribs|hip/.test(under) ? (this._leftOf(point) ? 'left ' : 'right ') : '';
        return { name: side + under, at: point };
    }

    // Whether a world point is on the person's left.
    _leftOf(point: BABYLON.Vector3) {
        const pelvis = this.npc.ragdoll.byName.get('pelvis');
        return V3.Dot(point.subtract(pelvis.node.position), pelvis.node.getDirection(V3.Right())) < 0;
    }

    // --- a break ------------------------------------------------------------------------------

    _break(name: string, type: string, how: string, ratio: number, rest, calibre = 0) {
        const key = keyOf(name), b = BONES[key], side = sideOf(name);
        const br: Break = { part: name, key, side, type, how, ratio, where: '', end: rest.end, s: rest.s, hit: rest.s, at: rest.p, dir: rest.d, owner: rest.owner,
            open: how === 'shot', seg: null, count: 1, level: '', text: '' };
        if (b.long) br.where = rest.end < 0 ? 'shaft' : ENDS[key][rest.end][0];
        // A shaft that lets go parts at the ragdoll's mid joint, the only place the limb and its skin can bend: drawn far
        // from it, the bone would part in one place and the leg bend in another, and the bone's end would stand out of the
        // leg. So it parts within a few centimetres of the middle; a bullet's pieces stay where the bullet went.
        if (br.where === 'shaft' && UNSTABLE.has(type)) br.s = clamp(br.s, 0.45, 0.55);
        // A second break of a bone already broken there makes the first worse, not a new one.
        const same = this.breaks.find((o) => o.part === name && o.where === br.where && Math.abs(o.s - br.s) < 0.15);
        if (same && !b.long) return same;
        if (same) {
            if (UNSTABLE.has(type) && GIVE[type][0] > (GIVE[same.type]?.[0] ?? 0) && same.seg) { same.type = type; this._loosen(same); }
            return same;
        }
        if (key === 'ribs') br.count = clamp(1 + Math.floor((ratio - 1) * 1.5), 1, 7);
        if (key === 'ribs' || /spine/.test(key)) br.level = this._level(name, rest.p, br.count);
        this.breaks.push(br);
        this.npc.insides.hurt(name);
        this._body(br);
        this._draw(br, calibre);
        this._partner(br);
        br.text = this._words(br);
        this.npc.vitals.injure(br.text, /femur|hip|spine|skull|sacrum/.test(key) ? 7 : key === 'ribs' && br.type === 'flail' ? 7 : 5);
        const world = V3.TransformCoordinates(br.at, this.npc.restToWorld(br.owner));
        this.npc.world.sound?.shot('crack', { at: world.asArray(), gain: clamp(0.5 + b.bend / 8000, 0.5, 1) });
        return br;
    }

    // A shaft driven far out of line takes the bone beside it with it: a displaced tibia breaks the fibula at about the
    // same level, a forearm hit hard enough breaks both its bones.
    _partner(br: Break) {
        const partner = PARTNER[br.key];
        if (!partner || br.where !== 'shaft' || !UNSTABLE.has(br.type) || br.how === 'shot') return;
        if (br.key === 'tibia' ? br.ratio < 1.3 && br.type === 'transverse' : br.ratio < 2) return;
        const name = `${wordOf(br.side)} ${partner}`;
        if (this.broken(name, 'shaft')) return;
        const rest = this._rest(name, null, null);
        rest.s = br.s;
        rest.p = this._axis(name).a.add(this._axis(name).u.scale(br.s * this._axis(name).length));
        this._break(name, br.type === 'comminuted' ? 'comminuted' : 'transverse', br.how, br.ratio, rest);
    }

    // Which ribs or which vertebrae, from the height of `p` in the part's own span.
    _level(name: string, p: BABYLON.Vector3, count: number) {
        const src = this.npc.insides.parts.find((x) => x.name === name).source;
        const [lo, hi] = src.bounds;
        const t = clamp((hi[1] - p.y) / (hi[1] - lo[1]), 0, 0.999);
        const key = keyOf(name);
        if (key === 'ribs') {
            const first = clamp(1 + Math.floor(t * 12) - Math.floor((count - 1) / 2), 1, 13 - count);
            return count > 1 ? `${first} to ${first + count - 1}` : `${first}`;
        }
        const [letter, from, n] = { 'neck spine': ['C', 1, 7], 'upper thoracic spine': ['T', 1, 6], 'lower thoracic spine': ['T', 7, 6], 'lumbar spine': ['L', 1, 5] }[key] as [string, number, number];
        return `${letter}${from + Math.floor(t * n)}`;
    }

    _words(br: Break) {
        const named = cap(br.part);
        if (br.key === 'ribs') {
            const what = br.count > 1 ? `${cap(wordOf(br.side))} ribs ${br.level} broken` : `${cap(wordOf(br.side))} rib ${br.level} broken`;
            return br.type === 'flail' ? `${what}, each in two places: flail chest` : what;
        }
        if (br.level) return `${named.replace(/ spine$/, '')} spine: ${WORDS[br.type] ?? 'fracture'} of ${br.level}`;
        const where = br.where ? ` of the ${br.where}` : '';
        return `${named}: ${WORDS[br.type] ?? 'fracture'}${where}${br.open ? ', open' : ''}`;
    }

    // --- what a break does to the body -----------------------------------------------------------

    _body(br: Break) {
        const npc = this.npc, v = npc.vitals, rd = npc.ragdoll, b = BONES[br.key], side = br.side;
        v.pain = Math.min(1, v.pain + b.pain);
        const litres = b.blood * br.count * (br.type === 'comminuted' ? 1.4 : 1) * (br.key === 'hip bone' && br.ratio > 1.6 ? 1.6 : 1);
        if (litres > 0.02) v.bleed({ name: `${br.part} fracture`, rate: litres * CLOT, internal: true, clots: CLOT });
        if (b.long) {
            const stable = br.type === 'gutter' || br.type === 'drill hole';
            if (/femur|tibia/.test(br.key) && br.type !== 'gutter') npc.legGone = true;
            if (br.where === 'shaft' && UNSTABLE.has(br.type)) {
                // The fibula carries a sixth of the weight and goes where the tibia lets the shin go: alone it lets nothing bend.
                if (br.key === 'fibula') { if (this.broken(`${wordOf(side)} tibia`, 'shaft')) br.seg = rd.byName.get('shin2' + side); return; }
                const name = b.long[2] + '2' + side;
                if (rd.breakAt(name)) npc.broke(b.long[2] + side);
                br.seg = rd.byName.get(name);
                this._loosen(br);
            } else if (br.end >= 0 && !stable) {
                const joint = rd.byName.get(ENDS[br.key][br.end][1] + side);
                if (joint) this._widen(joint, [0, 1, 2], 0.35);
                // A broken hip: the leg lies short and turned out, and nothing will lift it.
                if (br.key === 'femur' && br.end === 0) { this._widen(joint, [1], 0.9); joint.broken = true; }
                if (br.key === 'humerus' && br.end === 0) joint.broken = true;
            }
            return;
        }
        switch (br.key) {
            case 'ribs': {
                const s = side || 'R';
                // Every breath hurts and is held short; past twice what breaks one rib, a run of them breaks in two places and
                // the loose panel is sucked in as the rest of the chest goes out (Kroell's flail), and the ends tear the lung.
                if (br.count >= 3 && br.ratio > 2.6) br.type = 'flail';
                v.lungs[s] = Math.max(0.05, v.lungs[s] - 0.03 * br.count - (br.type === 'flail' ? 0.3 : 0));
                if (br.ratio > 2.2 || br.how === 'shot') { v.lungs[`leak${s}`] = true; npc.insides.hurt(`${wordOf(s)} lung`); v.injure(`Broken ribs tore the ${wordOf(s)} lung`, 7); }
                return;
            }
            case 'sternum':
                if (br.ratio > 2) { v.pump = Math.max(0, v.pump - 0.12); v.injure('Heart bruised against the spine', 6); }
                return;
            case 'clavicle':
            case 'scapula':
                if (br.key === 'clavicle') { const arm = rd.byName.get('upperarm' + side); if (arm) arm.broken = true; }
                return;
            case 'skull':
                return this._skull(br);
            case 'jaw':
                if (br.ratio > 1.6) { v.airway = Math.max(0.2, v.airway - 0.25); v.injure('Jaw broken on both sides: the tongue falls back', 5); }
                return;
            case 'hip bone':
            case 'sacrum':
                if (br.key === 'hip bone' || br.ratio > 1.3) npc.legGone = true;
                return;
            case 'kneecap': {
                // Nothing straightens the knee once its cap is in two.
                const shin = rd.byName.get('shin' + side);
                if (shin) shin.broken = true;
                npc.legGone = true;
                return;
            }
            case 'foot bones':
                if (br.how === 'fall') npc.legGone = true;
                return;
        }
        if (/spine/.test(br.key)) this._spine(br);
    }

    // A broken shaft's two halves, held as the kind of break holds them.
    _loosen(br: Break) {
        const seg = br.seg;
        if (!seg) return;
        // One forearm bone broken alone is splinted by the other.
        const partner = br.key === 'radius' ? 'ulna' : br.key === 'ulna' ? 'radius' : null;
        const share = partner && !this.broken(`${wordOf(br.side)} ${partner}`, 'shaft') ? 0.3 : 1;
        const give = GIVE[br.type] ?? GIVE.transverse;
        this._range(seg, give.map((g) => -g * share), give.map((g) => g * share));
        const c = seg.constraint;
        c.setAxisMode(AXIS.LINEAR_DISTANCE, LIMIT.LIMITED);
        c.setAxisMinLimit(AXIS.LINEAR_DISTANCE, 0);
        c.setAxisMaxLimit(AXIS.LINEAR_DISTANCE, SHORTEN[br.type] * share);
    }

    _skull(br: Break) {
        const npc = this.npc, v = npc.vitals;
        if (br.how === 'shot') return;     // the bullet's path through the brain is wounds.ts's
        v.concussion = Math.min(1, v.concussion + 0.3 + 0.2 * br.ratio);
        const src = npc.insides.parts.find((p) => p.name === 'skull').source;
        // Over the temple the bone is thinnest and the middle meningeal artery runs in a groove on its inside: a break
        // there tears it, and the blood collects between bone and brain, a lucid interval, then the brain is pressed.
        const temple = Math.abs(br.at.x - src.centre[0]) > 0.045 && br.at.y > src.centre[1] - 0.04 && br.at.y < src.centre[1] + 0.03;
        if (temple && !this.epidural) {
            this.epidural = v.bleed({ name: 'middle meningeal artery', rate: 0.0004, arterial: true, internal: true, clots: 0.0015 });
            v.injure('Artery torn under the temple: bleeding inside the skull', 8);
        }
        if (br.type === 'depressed') {
            v.brainDamage += 0.02 + 0.015 * br.ratio;
            npc.insides.hurt('brain');
            v.bleed({ name: 'brain', rate: 0.0006, internal: true, clots: 0.004 });
        }
        if (br.type === 'basilar') {
            v.injure('Blood and clear fluid from the ears and nose', 6);
            if (br.ratio > 2.5) { npc.insides.hurt('brainstem'); v.brainDamage += 0.3; }
        }
    }

    _spine(br: Break) {
        const npc = this.npc, v = npc.vitals, rd = npc.ragdoll;
        const joint = rd.byName.get(br.key === 'neck spine' ? 'head' : br.key === 'lumbar spine' ? 'belly' : 'chest');
        if (br.type === 'burst' || br.type === 'comminuted' || br.ratio > 1.8) this._widen(joint, [0, 2], 0.3);
        // A burst vertebra drives bone back into the canal: past half again what crushes it, into the cord.
        if ((br.type === 'burst' && br.ratio > 1.3) || br.type === 'comminuted') this.cord(br.level);
    }

    // The spinal cord crushed at `level` ('C4', 'T9'...): nothing below it moves, and from the fourth neck vertebra up
    // the diaphragm stops (its nerve leaves at C3 to C5).
    cord(level: string) {
        const v = this.npc.vitals, n = Number(level.slice(1));
        v.paralysed.legs = true;
        if (level[0] === 'C') {
            v.paralysed.arms = true;
            if (n <= 4) v.breathing = false;
        }
        v.injure(level[0] === 'C' && n <= 4 ? `Spinal cord crushed at ${level}: cannot breathe` : `Spinal cord crushed at ${level}: paralysed below it`, 10);
    }

    // --- what a break looks like ---------------------------------------------------------------

    // The break drawn: the bone round it taken out of the x-ray and drawn again as it now is (shards.ts), each piece with
    // the half of the bone it went with, the loose ones moved, and the line it broke along dark on it.
    _draw(br: Break, calibre: number) {
        const look = this._look(br, calibre), ax = BONES[br.key].long ? this._axis(br.part) : null;
        // What a point of the bone is on the near or far side of: the break, each line, which piece.
        const side = (cut: Cut, near: (p) => boolean, p: BABYLON.Vector3) => (near(p) ? (cut(p) > 0 ? '1' : '0') : '-');
        const label = (p: BABYLON.Vector3) => side(look.cut, look.near, p) + look.lines.map(([cut, near]) => side(cut, near, p)).join('') + (look.chunk?.(p) ?? '');
        // A piece of a broken shaft goes with the half on its side of the break, not of the middle.
        const owner = (t: Tri) => (br.seg ? (look.cut(t.centre) > 0 ? ax.far : ax.near) : t.owner);
        const tris = region(this.npc, br.part, look.take, ax ? look.cut : null, label, (t) => !(look.chunk?.(t.centre) >= 0) && owner(t) === t.owner);
        for (const t of tris) t.owner = owner(t);
        if (look.chunk) {
            const groups = new Map<number, Tri[]>();
            for (const t of tris) {
                const id = look.chunk(t.centre);
                if (id >= 0) (groups.get(id) ?? groups.set(id, []).get(id)).push(t);
            }
            for (const [id, group] of groups) {
                const centre = group.reduce((s, t) => s.addInPlace(t.centre), V3.Zero()).scaleInPlace(1 / group.length);
                const { shift, turn } = look.move(id, centre);
                const move = (p: BABYLON.Vector3) => p.subtract(centre).applyRotationQuaternion(turn).addInPlace(centre).addInPlace(shift);
                for (const t of group) { t.move = move; t.turn = turn; }
            }
        }
        br.tris = tris;
        br.lines = [[look.cut, look.near], ...look.lines];
        this._redraw(br);
    }

    // A break's meshes made again from its triangles: the bone, any of it out through the skin, and the lines.
    _redraw(br: Break) {
        for (const m of br.meshes ?? []) { m.dispose(); this.meshes = this.meshes.filter((k) => k !== m); }
        const npc = this.npc, still = br.tris.filter((t) => !t.move);
        const bare = br.tris.filter((t) => t.move && t.bare);
        br.meshes = [bone(npc, br.tris.filter((t) => !t.bare)), bone(npc, bare, (p) => clamp(1 + br.cut(p) / 0.015, 0, 1)),
            ...br.lines.map(([cut, near]) => crack(npc, still, cut, near))].filter(Boolean);
        this.meshes.push(...br.meshes);
    }

    // How a break looks, in the person's rest space: the bone it takes out of the x-ray (`take`), the surface it broke
    // along (`cut`, its line drawn `near` it), any more lines, and the loose pieces (`chunk` says which piece a point of
    // the bone is in, -1 none; `move` where piece `id` went).
    _look(br: Break, calibre: number) {
        const c = br.at, n = br.dir;
        const near = (r: number) => (p: BABYLON.Vector3) => V3.DistanceSquared(p, c) < r * r;
        const plane = (normal: BABYLON.Vector3, rough = 0.002, origin = c): Cut => (p) => V3.Dot(p.subtract(origin), normal) + jag(p, rough);
        const tilt = (axis: BABYLON.Vector3, angle: number) => Q.RotationAxis(axis.lengthSquared() > 1e-8 ? axis.normalize() : V3.Up(), angle);
        // Lines running out from a blow or a bullet's hole across a flat bone: planes through it, each drawn on one side.
        const radiating = (count: number, from: number, to: number): [Cut, (p) => boolean][] => Array.from({ length: count }, (_, k) => {
            const m = across(n, new V3(Math.cos(k * 2.1 + 0.4), Math.sin(k * 1.7), Math.cos(k * 2.9)));
            return [plane(V3.Cross(n, m).normalize()), (p) => { const d = V3.Distance(p, c); return d > from && d < to && V3.Dot(p.subtract(c), m) > 0; }];
        });
        type Look = { take: (p) => boolean; cut: Cut; near: (p) => boolean; lines: [Cut, (p) => boolean][]; chunk?: (p) => number; move?: (id: number, centre: BABYLON.Vector3) => { shift: BABYLON.Vector3; turn: BABYLON.Quaternion } };

        if (BONES[br.key].long) {
            const ax = this._axis(br.part), u = ax.u, d = across(u, n), e2 = V3.Cross(u, d);
            const at = (s: number) => ax.a.add(u.scale(s * ax.length));
            const along = (p: BABYLON.Vector3, s: number) => V3.Dot(p.subtract(at(s)), u);
            const outward = (p: BABYLON.Vector3, s: number) => { const r = p.subtract(at(s)); return r.subtract(u.scale(V3.Dot(r, u))).normalize(); };
            if (br.type === 'gutter' || br.type === 'drill hole') {
                // A hole the bullet's width punched through the bone (or a groove scored along it), its rim cracked.
                const r = Math.max(0.004, calibre * 0.7), off = (p) => { const q = p.subtract(c); return q.subtract(n.scale(V3.Dot(q, n))).length(); };
                return { take: near(0.05), cut: (p) => off(p) - r * 1.6 + jag(p, 0.0015), near: near(0.05), lines: [],
                    chunk: (p) => (off(p) < r ? 0 : -1), move: () => ({ shift: n.scale(0.02), turn: Q.Identity() }) } as Look;
            }
            const mid = at(br.s), rough = br.type === 'comminuted' ? 0.005 : br.type === 'butterfly' ? 0.003 : 0.0015;
            const cut: Cut = br.type === 'spiral'
                ? (p) => { const q = p.subtract(mid); return V3.Dot(q, u) - (0.07 * Math.atan2(V3.Dot(q, e2), V3.Dot(q, d))) / (2 * Math.PI) + jag(p, 0.0012); }
                : br.type === 'oblique' ? (p) => V3.Dot(p.subtract(mid), u) + 0.9 * V3.Dot(p.subtract(mid), d) + jag(p, 0.0015)
                    : (p) => V3.Dot(p.subtract(mid), u) + jag(p, rough);
            br.cut = cut;
            const look: Look = { take: (p) => Math.abs(along(p, br.s)) < 0.06 || (br.how === 'shot' && Math.abs(along(p, br.hit)) < 0.04), cut,
                near: (p) => Math.abs(along(p, br.s)) < 0.06, lines: [] };
            if (br.type === 'butterfly') {
                // The wedge knocked out of the side the blow (or the bullet) came in on, its point on the far side.
                const s = br.how === 'shot' ? br.hit : br.s;
                look.chunk = (p) => { const facing = V3.Dot(outward(p, s), n.scale(-1)); return facing > 0.2 && Math.abs(along(p, s)) < (0.025 * (facing - 0.2)) / 0.8 ? 0 : -1; };
                look.move = (_, centre) => ({ shift: outward(centre, s).scale(0.006).add(n.scale(br.how === 'shot' ? 0.01 : 0)), turn: tilt(e2, 0.25) });
            }
            if (br.type === 'comminuted') {
                // Pieces all round the break, thrown out from the bone and, by a bullet, on along its path.
                const s = br.how === 'shot' ? br.hit : br.s, zone = br.how === 'shot' ? 0.03 : 0.018, sector = Math.PI / 3;
                look.chunk = (p) => {
                    const q = p.subtract(at(s)), a = V3.Dot(q, u);
                    return Math.abs(a) > zone ? -1 : Math.floor((Math.atan2(V3.Dot(q, e2), V3.Dot(q, d)) + Math.PI) / sector) + (a > 0 ? 6 : 0);
                };
                look.move = (id, centre) => ({ shift: outward(centre, s).scale(0.004 + (id % 3) * 0.003).add(n.scale(br.how === 'shot' ? 0.008 + (id % 4) * 0.006 : 0)),
                    turn: tilt(new V3(Math.sin(id * 1.3), Math.cos(id * 2.1), Math.sin(id * 0.7)), 0.3) });
            }
            return look;
        }
        if (br.key === 'skull') {
            if (br.type === 'depressed' || br.how === 'shot') {
                // A disc of bone pushed in on the brain, in a few pieces, with lines running out from it; a bullet's hole is
                // the same, smaller, its bone carried in along the track.
                const r = br.how === 'shot' ? Math.max(0.006, calibre) : 0.022, m = across(n, V3.Up()), m2 = V3.Cross(n, m);
                return { take: near(0.09), cut: (p) => V3.Distance(p, c) - r * 1.1 + jag(p, 0.0015), near: near(r * 1.6), lines: radiating(3, r, 0.08),
                    chunk: (p) => (V3.Distance(p, c) < r ? Math.floor((Math.atan2(V3.Dot(p.subtract(c), m2), V3.Dot(p.subtract(c), m)) + Math.PI) / (Math.PI / 2)) : -1),
                    move: (id, centre) => ({ shift: n.scale(br.how === 'shot' ? 0.02 : 0.007), turn: tilt(V3.Cross(n, centre.subtract(c)), 0.25 + id * 0.03) }) } as Look;
            }
            if (br.type === 'basilar') return { take: near(0.07), cut: (p) => p.y - c.y + jag(p, 0.003), near: near(0.07), lines: [] } as Look;
            const [[cut, along], ...more] = radiating(br.ratio > 1.4 ? 2 : 1, 0, 0.07);
            return { take: near(0.075), cut, near: along, lines: more } as Look;
        }
        if (br.key === 'ribs') {
            // Each rib broken where the blow landed: a cut down through the run of them; a flail run broken in two places,
            // the panel between pushed in.
            const t = across(V3.Cross(V3.Up(), n), new V3(n.z, 0, -n.x)), span = br.count * 0.024, other = c.add(t.scale(0.07));
            const ribs = (p: BABYLON.Vector3) => Math.abs(p.y - c.y) < span / 2 && V3.Distance(p, c) < 0.15;
            const look: Look = { take: ribs, cut: plane(t, 0.003), near: ribs, lines: [] };
            if (br.type === 'flail') {
                look.lines.push([plane(t, 0.003, other), ribs]);
                look.chunk = (p) => (ribs(p) && V3.Dot(p.subtract(c), t) > 0.004 && V3.Dot(p.subtract(other), t) < -0.004 ? 0 : -1);
                look.move = () => ({ shift: n.scale(0.01), turn: Q.Identity() });
            }
            return look;
        }
        if (/spine|sacrum/.test(br.key)) {
            // Across the vertebral body at its level; burst, its pieces pushed out all round, some back into the canal.
            const flat = (p: BABYLON.Vector3) => Math.hypot(p.x - c.x, p.z - c.z) < 0.06;
            const look: Look = { take: (p) => flat(p) && Math.abs(p.y - c.y) < 0.03, cut: (p) => p.y - c.y + jag(p, 0.0015), near: flat, lines: [] };
            if (br.type === 'burst' || br.type === 'comminuted') {
                look.chunk = (p) => (flat(p) && Math.abs(p.y - c.y) < 0.012 ? Math.floor((Math.atan2(p.z - c.z, p.x - c.x) + Math.PI) / (Math.PI / 2)) : -1);
                look.move = (_, centre) => ({ shift: new V3(centre.x - c.x, 0, centre.z - c.z).normalize().scale(0.005), turn: Q.Identity() });
            }
            return look;
        }
        // Any other bone: a line through where it was struck, and pieces there if it shattered.
        const look: Look = { take: near(0.05), cut: plane(V3.Cross(n, across(n, V3.Up())).normalize()), near: near(0.05), lines: [] };
        if (br.type === 'comminuted') {
            look.chunk = (p) => (V3.Distance(p, c) < 0.014 ? (p.x > c.x ? 1 : 0) + (p.y > c.y ? 2 : 0) : -1);
            look.move = (id) => ({ shift: n.scale(0.006 + id * 0.002), turn: Q.Identity() });
        }
        return look;
    }

    // --- every physics step -----------------------------------------------------------------------

    update() {
        const npc = this.npc;
        // The first second and a half is the body settling into its stance.
        this._falls(npc.world.frame - this._born < 90);
        if (npc.world.frame - this._born < 90) return;
        this._opens();
        if (this.epidural?.lost > 0.03) npc.vitals.brainDamage = Math.max(npc.vitals.brainDamage, (this.epidural.lost - 0.03) * 2);
    }

    // A segment that was coming down and has just been stopped by the floor: the force of it, on what it landed on.
    _falls(settling: boolean) {
        const rd = this.npc.ragdoll;
        for (const seg of rd.segments) {
            seg.body.getLinearVelocityToRef(_v);
            const before = this._vy.get(seg) ?? 0;
            this._vy.set(seg, _v.y);
            if (settling || before > -2 || _v.y < before * 0.4 || rd.lowest(seg) > FLOOR + 0.06) continue;
            this._land(seg, -before);
        }
    }

    _land(seg, speed: number) {
        const rd = this.npc.ragdoll, base = seg.name.replace(/[LR]$/, ''), side = seg.name.endsWith('L') ? 'L' : 'R', word = wordOf(side);
        if (!(base in LANDING)) return;
        // A limb brings the body's weight down with it only if the body is coming down too: a foot or a hand dropped on
        // its own is a kilo of flesh.
        rd.byName.get('pelvis').body.getLinearVelocityToRef(_w);
        const trunk = base === 'head' || base === 'chest' || base === 'pelvis';
        // (Feet carry it only landed on upright, the hips over them.)
        const upright = base !== 'foot' || rd.byName.get('pelvis').node.position.y - seg.node.position.y > 0.6;
        const m = trunk || (-_w.y > speed * 0.5 && upright) ? rd.mass * LANDING[base] : seg.mass;
        const at = rd.worldPoint(seg, seg.centre, new V3());
        at.y = rd.lowest(seg);
        const down = new V3(0, -1, 0);
        const hit = (name: string, k = BONES[keyOf(name)].pad, end = -1) => this.load(name, 'fall', { force: speed * Math.sqrt(k * m), at, dir: down, end });
        const crush = (name: string, k: number, share = 1) => this.load(name, 'fall', { axial: share * speed * Math.sqrt(k * m), at, dir: down });
        // Which side is down, for a body landing on its side: its right is pointing up or down.
        const onSide = (s) => { const r = s.node.getDirection(V3.Right()); return Math.abs(r.y) > 0.55 ? (r.y > 0 ? 'left' : 'right') : null; };
        switch (base) {
            case 'head': {
                hit('skull');
                // Head first with the body coming down on top of it: the neck is crushed along its length (a diver's burst
                // fracture of the fifth or sixth vertebra).
                const chest = rd.byName.get('chest');
                chest.body.getLinearVelocityToRef(_w);
                if (chest.node.position.y > seg.node.position.y + 0.15 && -_w.y > speed * 0.6) this.load('neck spine', 'fall', { axial: speed * Math.sqrt(100e3 * rd.mass * 0.3), at, dir: down });
                return;
            }
            case 'pelvis': {
                const low = onSide(seg);
                // On the side: the greater trochanter takes it, and the femur's neck behind it is what breaks in the old.
                if (low) hit(`${low} femur`, 71e3, 0) ?? hit(`${low} hip bone`, 71e3);
                else crush('sacrum', 70e3, 0.6);
                return;
            }
            case 'chest': { const low = onSide(seg); if (low) hit(`${low} ribs`); return; }
            // The point of the shoulder, in a fall on that side: the clavicle is crushed along its length.
            case 'upperarm':
                if (onSide(rd.byName.get('chest')) === word) crush(`${word} clavicle`, 80e3) ?? hit(`${word} humerus`, 80e3, 0);
                return;
            // A fall onto the outstretched hand: the end of the radius (Colles').
            // If the radius holds, a young man's elbow can be levered out of its socket instead: an estimate, the hand's
            // force (Chiu and Robinovitch) over the centimetre or so the olecranon gives it, so that only a hard fall does it.
            case 'hand': {
                const force = speed * Math.sqrt(100e3 * m);
                if (!hit(`${word} radius`, 100e3, 1) && m > seg.mass) this._overload(rd.byName.get('forearm' + side), 0, force * 0.012);
                return;
            }
            case 'shin': hit(`${word} kneecap`); return;
            case 'foot':
                // Feet first from a height: the heel bursts, the shin's lower end is driven into the ankle, and what is left
                // of the force goes up the spine and crushes a lumbar vertebra.
                crush(`${word} foot bones`, 200e3);
                crush(`${word} tibia`, 200e3, 0.8);
                if (speed > 5) this.load('lumbar spine', 'fall', { axial: 0.5 * speed * Math.sqrt(200e3 * rd.mass * 0.6) });
                return;
        }
    }

    // A blow of `force` N along `dir` landing within a few centimetres of a joint: bent sideways, or straightened past its
    // range, the joint takes it.
    _atJoint(point: BABYLON.Vector3, dir: BABYLON.Vector3, force: number) {
        const rd = this.npc.ragdoll, angles = [0, 0, 0];
        for (const seg of rd.segments) {
            if (!JOINTS[seg.name.replace(/[LR]$/, '')] || this.joints.has(seg.name) || V3.Distance(seg.node.position, point) > 0.08) continue;
            const hinge = seg.frame[0].applyRotationQuaternion(seg.parent.node.rotationQuaternion);
            rd.angles(seg, angles);
            // Pushed along the hinge's axis it bends sideways; across it, it only bends the wrong way if it is already straight.
            if (Math.abs(V3.Dot(dir, hinge)) > 0.6) this._overload(seg, 2, force * LEVER);
            else if (angles[0] < seg.lo[0] + 0.17 || angles[0] > seg.hi[0] - 0.17) this._overload(seg, 0, force * LEVER);
            return;
        }
    }

    _overload(seg, axis: number, torque: number) {
        const base = seg.name.replace(/[LR]$/, ''), side = seg.name.endsWith('L') ? 'L' : seg.name.endsWith('R') ? 'R' : '';
        const j = JOINTS[base];
        if (!j) return;
        const word = side ? wordOf(side) : '', v = this.npc.vitals;
        const holds = j.holds * this.cortical * this.build;
        if (torque < holds) return;
        const joint = `${side ? cap(word) + ' ' : ''}${j.name}`;
        switch (j.gives) {
            case 'dislocated':
                this._dislocate(seg, `${joint} dislocated`);
                return;
            case 'wrist':
                // Bent back past its range, the wrist breaks the radius's end (the lever is the 3 cm to the carpus), or sprains.
                if (!this.load(`${word} radius`, 'wrench', { force: torque / 0.03, end: 1 })) this._tear(seg, axis, joint, 0.3);
                return;
            case 'torn':
                // A knee forced well past its range comes apart altogether, and takes the artery behind it.
                if (base === 'shin' && torque > holds * 1.6) {
                    this._dislocate(seg, `${joint} dislocated`);
                    const tube = this.npc.insides.tubes.find((t) => t.name === `${word} popliteal artery`);
                    v.bleed({ name: `${word} popliteal artery`, rate: 0.006, arterial: true, internal: true, clots: 0.004, source: tube ? { tube, at: 0 } : undefined });
                    v.injure(`${cap(word)} popliteal artery torn behind the knee`, 8);
                    this.npc.legGone = true;
                    return;
                }
                if (base === 'foot' && torque > holds * 1.8) {
                    this.load(`${word} tibia`, 'wrench', { force: 1e5, end: 1 });
                    this.load(`${word} fibula`, 'wrench', { force: 1e5, end: 1 });
                    return;
                }
                this._tear(seg, axis, joint, 0.45);
                if (base === 'shin') this.npc.legGone = true;
        }
    }

    // A joint's ligaments torn across axis `axis`: it opens up that way `by` radians further than it should.
    _tear(seg, axis: number, joint: string, by: number) {
        this.joints.set(seg.name, 'torn');
        this._widen(seg, [axis], by);
        this.npc.vitals.pain = Math.min(1, this.npc.vitals.pain + 0.35);
        this.npc.vitals.injure(`${joint}: ligaments torn`, 5);
        this._crack(seg.node.position, 0.5);
    }

    // A joint out of its socket: locked where it went, a little either way (the springy fixation a doctor feels), and
    // nothing the muscles can move. A shoulder out the front holds the arm a little out and turned out; an elbow out
    // the back holds the forearm bent at forty-five degrees.
    _dislocate(seg, text: string) {
        const pose = OUT[seg.name.replace(/[LR]$/, '')];
        if (pose) {
            const at = pose.map((deg, i) => deg * RAD * (seg.sign?.[i] ?? 1));
            this._range(seg, at.map((x) => x - 0.12), at.map((x) => x + 0.12));
        } else this._widen(seg, [0, 1, 2], 0.5);
        seg.broken = true;
        this.joints.set(seg.name, 'dislocated');
        const v = this.npc.vitals;
        v.pain = Math.min(1, v.pain + 0.5);
        if (/thigh|shin/.test(seg.name)) this.npc.legGone = true;
        v.injure(text, 6);
        this._crack(seg.node.position, 0.6);
    }

    _crack(at: BABYLON.Vector3, gain: number) { this.npc.world.sound?.shot('crack', { at: at.asArray(), gain }); }

    // --- joints' ranges -----------------------------------------------------------------------

    // A joint's range set to `lo` to `hi` (radians: hinge, twist, side), in Havok and where the muscles read it.
    _range(seg, lo: number[], hi: number[]) {
        ANGULAR.forEach((axis, i) => {
            seg.constraint.setAxisMode(axis, LIMIT.LIMITED);
            seg.constraint.setAxisMinLimit(axis, lo[i]);
            seg.constraint.setAxisMaxLimit(axis, hi[i]);
            seg.lo[i] = lo[i];
            seg.hi[i] = hi[i];
        });
    }

    // A joint's range opened `by` radians either way on `axes`: what held it there is torn.
    _widen(seg, axes: number[], by: number) {
        if (!seg) return;
        const lo = [...seg.lo], hi = [...seg.hi];
        for (const i of axes) { lo[i] -= by; hi[i] += by; }
        this._range(seg, lo, hi);
    }

    // --- open fractures -------------------------------------------------------------------------

    // A broken shaft bent far enough at the break: the end of the near half comes out through the skin at the outside
    // of the bend, where the two halves make their point.
    _opens() {
        const rd = this.npc.ragdoll, a = [0, 0, 0];
        for (const br of this.breaks) {
            if (!br.seg || br.through || !BONES[br.key].open) continue;
            rd.angles(br.seg, a);
            const bend = Math.hypot(a[0], a[2]) / RAD;
            if (bend > BONES[br.key].open) this._through(br);
        }
    }

    _through(br: Break) {
        br.through = true;
        const npc = this.npc, seg = br.seg, near = seg.parent;
        const ax = this._axis(br.part);
        const toWorld = npc.restToWorld(ax.near);
        const end = ax.a.add(ax.u.scale(br.s * ax.length));
        const bone = V3.TransformCoordinates(end, toWorld);
        // The point of the bend: away from where the far half now points, square to the near half.
        const nearAlong = near.end.normalizeToNew().applyRotationQuaternion(near.node.rotationQuaternion);
        const farAlong = seg.end.normalizeToNew().applyRotationQuaternion(seg.node.rotationQuaternion);
        // A tibia comes out through the inner front of the shin, where there is nothing over it but skin, whichever way the
        // leg bent.
        const inward = near.node.getDirection(V3.Right()).scale(br.side === 'R' ? -0.5 : 0.5);
        const point = br.key === 'tibia' ? across(nearAlong, near.node.getDirection(V3.Forward()).add(inward)) : across(nearAlong, farAlong.subtract(nearAlong).scale(-1));
        const first = npc.surface(bone, point, 0.25).find((h) => h.kind === 'skin');
        if (!first) return;
        // The near half's last few centimetres, splinters and all, swung out about a point that far back up the bone, so the
        // end that broke stands four and a half centimetres out of the skin.
        const tip = V3.TransformCoordinates(first.point.add(point.scale(0.045)), toWorld.clone().invert());
        const length = 0.055, pivot = end.subtract(ax.u.scale(length)), turn = new Q();
        Q.FromUnitVectorsToRef(ax.u, tip.subtract(pivot).normalize(), turn);
        const shift = tip.subtract(pivot.add(end.subtract(pivot).applyRotationQuaternion(turn)));
        const move = (p: BABYLON.Vector3) => p.subtract(pivot).applyRotationQuaternion(turn).addInPlace(pivot).addInPlace(shift);
        // The skin and clothes torn open where the end comes through them.
        const from = V3.TransformCoordinates(pivot.add(shift), toWorld), to = V3.TransformCoordinates(tip, toWorld);
        const hits = npc.surface(from, to.subtract(from).normalize(), V3.Distance(from, to) + 0.03);
        const skin = hits.find((h) => h.kind === 'skin') ?? first;
        br.wound = skin;
        br.out = point;
        npc.marks.exit(skin, 0.03);
        npc.marks.hole(skin, 0.018, true);
        const cloth = hits.find((h) => h.kind === 'cloth' && h.t > skin.t);
        if (cloth) { npc.wound(cloth, 'out', 0.04); skin.cloth = cloth; }
        // (The end's bone still in the x-ray as it was, taken out to come with it.)
        const out = (p: BABYLON.Vector3) => { const k = br.cut(p); return k <= 0 && k > -length; };
        br.tris.push(...region(npc, br.part, out, null, () => '').map((t) => Object.assign(t, { owner: ax.near })));
        for (const t of br.tris) if (out(t.centre)) Object.assign(t, { move, turn, bare: true });
        this._redraw(br);
        const v = npc.vitals;
        br.open = true;
        v.pain = Math.min(1, v.pain + 0.3);
        v.bleed({ name: `${br.part} open fracture`, rate: 0.0025, clots: 0.004, source: { mark: skin } });
        v.injure(`${cap(br.part)}: bone out through the skin`, 7);
        this._crack(bone, 0.7);
    }

    dispose() {
        this.npc.world.scene.onAfterPhysicsObservable.remove(this._observer);
        for (const m of this.meshes) m.dispose();
    }
}
