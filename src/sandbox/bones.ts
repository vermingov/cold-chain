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
import { Teeth } from './teeth.ts';
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion;
const AXIS = BABYLON.PhysicsConstraintAxis, LIMIT = BABYLON.PhysicsConstraintAxisLimitMode;
const ANGULAR = [AXIS.ANGULAR_X, AXIS.ANGULAR_Y, AXIS.ANGULAR_Z];

// Each bone by its name (side left off): its strength in a young adult man, and what lies over it. The figures and
// their sources are in dev/research/blunt-trauma.md; laboratory specimens are mostly elderly, so these are the
// middles of what is reported, and every body varies round them (`grain`).
//   moment  N m of bending a long bone's shaft takes (three-point bending at speed: Kerrigan 2004, Nyquist 1985,
//           Kirkish 1996, Pintar 1998; the ulna goes before the radius)
//   bend    N across a flat bone, measured with a 6.5 cm2 impactor (skull: Yoganandan 1995, Nahum 1968; face: Nahum
//           1975; clavicle 1.48 kN axial)
//   twist   N m about its length before it breaks in a spiral
//   ends    N on its spongy ends (the femur's neck in a fall on the hip: Courtney 1995, 7.2 kN young, 3.4 kN old)
//   axial   N along it (vertebrae: Brinckmann 1989; the neck 2.2 kN in men; the tibia 16.6 kN at speed, Crandall)
//   pad     N/m: how stiff the flesh over it is (the spring in F = v sqrt(k m))
//   wide    m: how thick it is where a bullet crosses it (a shaft across, a flat bone through)
//   blood   litres a closed fracture of it bleeds into the tissues (ATLS: femur 1-1.5, tibia 0.75, humerus 0.5-0.75,
//           pelvis 1.5-3, a rib 0.1-0.15)
//   open    degrees the shaft must bend at the break before its end comes through the skin: the shin's front has
//           nothing over it but skin, the thigh has the whole quadriceps (none for the fibula, deep in the calf's muscle)
//   long    [its first bone, the bone at its far end, the ragdoll segment it is in]
type Bone = { bend: number; moment?: number; twist?: number; ends?: number; axial?: number; pad: number; wide?: number; blood: number; open?: number;
    long?: [string, string, string]; pain: number };
const BONES: Record<string, Bone> = {
    femur: { bend: 4300, moment: 447, twist: 180, ends: 7000, pad: 40e3, wide: 0.028, blood: 1.25, open: 55, long: ['upperleg01', 'lowerleg01', 'thigh'], pain: 0.6 },
    tibia: { bend: 3500, moment: 312, twist: 95, ends: 5000, axial: 16600, pad: 300e3, wide: 0.024, blood: 0.75, open: 25, long: ['lowerleg01', 'foot', 'shin'], pain: 0.55 },
    fibula: { bend: 700, moment: 60, twist: 25, ends: 2000, pad: 100e3, wide: 0.012, blood: 0.1, long: ['lowerleg01', 'foot', 'shin'], pain: 0.3 },
    humerus: { bend: 1330, moment: 230, twist: 70, ends: 3000, pad: 80e3, wide: 0.022, blood: 0.6, open: 45, long: ['upperarm01', 'lowerarm01', 'upperarm'], pain: 0.5 },
    radius: { bend: 520, moment: 100, twist: 20, ends: 3800, pad: 150e3, wide: 0.015, blood: 0.25, open: 30, long: ['lowerarm01', 'wrist', 'forearm'], pain: 0.45 },
    ulna: { bend: 630, moment: 94, twist: 20, ends: 2500, pad: 300e3, wide: 0.014, blood: 0.25, open: 30, long: ['lowerarm01', 'wrist', 'forearm'], pain: 0.45 },
    clavicle: { bend: 1480, axial: 1480, wide: 0.012, pad: 300e3, blood: 0.1, pain: 0.45 },
    scapula: { bend: 3500, wide: 0.006, pad: 40e3, blood: 0.3, pain: 0.4 },
    rib: { bend: 2500, wide: 0.01, pad: 100e3, blood: 0.12, pain: 0.15 },
    sternum: { bend: 4000, wide: 0.012, pad: 300e3, blood: 0.15, pain: 0.45 },
    skull: { bend: 6100, wide: 0.008, pad: 500e3, blood: 0, pain: 0.4 },
    maxilla: { bend: 1300, wide: 0.006, pad: 300e3, blood: 0.1, pain: 0.5 },
    zygoma: { bend: 1600, wide: 0.008, pad: 300e3, blood: 0.05, pain: 0.45 },
    nasal: { bend: 450, wide: 0.004, pad: 300e3, blood: 0, pain: 0.4 },
    jaw: { bend: 1800, wide: 0.012, pad: 400e3, blood: 0.05, pain: 0.5 },
    // The hyoid and the voice box are estimates: they break from blows and grips to the front of the neck that leave
    // the neck's bones whole, and more easily in the old, whose cartilage has turned to brittle bone.
    hyoid: { bend: 400, wide: 0.004, pad: 100e3, blood: 0.02, pain: 0.45 },
    larynx: { bend: 700, wide: 0.004, pad: 100e3, blood: 0.03, pain: 0.5 },
    'cervical vertebra': { bend: 3000, axial: 2240, wide: 0.02, pad: 100e3, blood: 0.05, pain: 0.5 },
    'thoracic vertebra': { bend: 4000, axial: 4500, wide: 0.03, pad: 150e3, blood: 0.1, pain: 0.5 },
    'lumbar vertebra': { bend: 5000, axial: 6000, wide: 0.035, pad: 150e3, blood: 0.15, pain: 0.55 },
    sacrum: { bend: 5000, axial: 5000, wide: 0.03, pad: 70e3, blood: 0.5, pain: 0.55 },
    'hip bone': { bend: 8000, wide: 0.015, pad: 70e3, blood: 1.5, pain: 0.65 },
    kneecap: { bend: 6000, wide: 0.02, pad: 150e3, blood: 0.05, pain: 0.45 },
    // The small bones of the hand and foot (estimates against the forces of a fall on the hand, a punch's knuckles and
    // a stamped foot): the scaphoid is what a young man breaks falling on his hand, a metacarpal what a punch breaks.
    scaphoid: { bend: 2400, wide: 0.012, pad: 150e3, blood: 0.02, pain: 0.35 },
    carpal: { bend: 3000, wide: 0.012, pad: 150e3, blood: 0.02, pain: 0.35 },
    metacarpal: { bend: 900, wide: 0.009, pad: 200e3, blood: 0.02, pain: 0.35 },
    finger: { bend: 350, wide: 0.007, pad: 200e3, blood: 0.01, pain: 0.3 },
    calcaneus: { bend: 4000, axial: 7000, wide: 0.03, pad: 200e3, blood: 0.15, pain: 0.45 },
    tarsal: { bend: 3000, axial: 7000, wide: 0.02, pad: 200e3, blood: 0.05, pain: 0.4 },
    metatarsal: { bend: 1000, wide: 0.01, pad: 200e3, blood: 0.03, pain: 0.35 },
    toe: { bend: 350, wide: 0.008, pad: 200e3, blood: 0.01, pain: 0.3 },
};
// The skull by where it is struck, N with a 6.5 cm2 impactor: the temple is thinnest (Nahum: 3.9 kN in men), the
// forehead 2.7-9.9 kN, the side 4.2-9.6 (Stalnaker); the face far less: the nose lowest of all (never measured, it
// always broke first), the maxilla 0.63-1.98 kN, the zygoma 0.61-3.47, the mandible 0.82-3.4 from the side and
// 1.9-4.1 at the chin (Nahum 1975).
// The eye socket's floor is paper-thin and goes when something broad drives the eye back (estimate: below the cheek);
// the jaw takes more at the chin than from the side.
const PLACES = { temple: 3900, forehead: 6300, side: 6100, back: 8000, base: 6100, eye: 1200, chin: 2800 };
// Which bone of the skull is which place on it.
const VAULT: [RegExp, string][] = [[/^frontal/, 'forehead'], [/temporal/, 'temple'], [/parietal/, 'side'], [/^occipital/, 'back'], [/sphenoid|ethmoid/, 'base']];
// What hits: how stiff it is (N/m) and the patch it lands on (cm2). A fist and the arm behind it give (an untrained
// punch is 0.5-0.85 kN, a boxer's 3.4 kN at 9 m/s: Walilko 2005); a bat is a 6.5 cm cylinder; halving the patch about
// doubles the chance of a fracture (Yoganandan), so thresholds measured with 6.5 cm2 scale with the patch. A claw hammer's
// face is about an inch across (5 cm2: Goots18's hammer impactor).
// A wall met by a body part (thuds.ts) is flat and wider than any part: it meets it along its whole length.
const TOOLS = { fist: { k: 9e3, area: 40 }, bat: { k: 2e6, area: 8 }, flat: { k: 5e6, area: 25 }, edge: { k: 5e6, area: 2 }, hammer: { k: 5e6, area: 5 },
    wall: { k: 5e6, area: 2500 } };
// Ribs break by how far the chest is pushed in, not how fast: past a fifth of its depth they break, past two fifths a
// panel of them breaks in two places (Kroell); the chest is about 23 cm deep and about 40 N/mm stiff to a broad load.
const CHEST_DEPTH = 0.23, CHEST_STIFF = 40e3;
// Unprotected head on a hard floor: the speed that fractured cadaver skulls in Gurdjian's drops, m/s.
const DROP = { forehead: 4.6, back: 4.9, side: 5.7, temple: 5.0 };
// A long bone's ends: what a break there is called, and the joint it loosens (the ragdoll segment below the joint).
const ENDS: Record<string, [string, string | null][]> = {
    femur: [['neck (the hip)', 'thigh'], ['lower end, above the knee', 'shin']],
    tibia: [['top, into the knee', 'shin'], ['lower end, into the ankle', 'foot']],
    fibula: [['head, below the knee', null], ['lower end, at the ankle', 'foot']],
    humerus: [['neck, at the shoulder', 'upperarm'], ['lower end, above the elbow', 'forearm']],
    radius: [['head, at the elbow', 'forearm'], ['lower end, at the wrist', 'hand']],
    ulna: [['top, at the elbow', 'forearm'], ['lower end, at the wrist', 'hand']],
};
// What each break of the face is called on the monitor ($side where it is one-sided).
const FACE = { hyoid: 'Hyoid bone broken: swallowing and breathing hurt', larynx: 'Voice box broken: hoarse, breathing noisily', nasal: 'Nose broken', blowout: '$Side eye socket\'s floor blown out: the eye sinks and sees double', zygoma: '$Side cheekbone broken and pushed in',
    lefort1: 'Le Fort I fracture: the upper teeth and palate broken loose', lefort2: 'Le Fort II fracture: the middle of the face broken loose through the nose',
    lefort3: 'Le Fort III fracture: the face broken off the skull', chin: 'Jaw broken at the chin', body: 'Jaw broken along the $side teeth',
    angle: 'Jaw broken at the $side angle', condyle: 'Jaw broken at the $side joint', condyles: 'Jaw broken at both joints from the blow to the chin' };
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
    thigh: { name: 'hip', holds: 250, gives: 'dislocated' },
    // The neck's facet joints: the upper cervical spine holds about 17 N m twisted (AI-Neck), more bent.
    head: { name: 'neck', holds: 60, gives: 'facets' },
};
// Where a dislocated joint is held (hinge, twist, side; degrees, as the pose controls count them); none for a knee,
// which once out holds nowhere.
const OUT = { upperarm: [25, 35, 30], forearm: [45, 0, 0], thigh: [45, -30, -20] };
// The share of a person's weight behind each part that breaks a fall when it hits the floor: the hip carries about
// half the body into it in a fall on the side (Robinovitch et al. 1991), an outstretched hand a few per cent, the elbow
// giving (Chiu and Robinovitch 1998), a shoulder or the side of the chest a tenth with the arm taking some.
const LANDING = { head: 0.06, chest: 0.1, pelvis: 0.4, hand: 0.05, foot: 0.5 };
const LEVER = 0.05;             // m: a blow's force on the joint it lands at acts over about an eighth of the limb
const STRUCK = { head: 0.08, chest: 0.3, belly: 0.2, pelvis: 0.4, upperarm: 0.04, upperarm2: 0.035, forearm: 0.022, forearm2: 0.022, hand: 0.008,
    thigh: 0.15, thigh2: 0.12, shin: 0.06, shin2: 0.05, foot: 0.02 };
// The bone a blow to each segment lands on when the line it came along misses every bone.
const UNDER = { head: 'frontal bone', pelvis: 'hip bone', upperarm: 'humerus', forearm: 'ulna', hand: 'third metacarpal bone',
    thigh: 'femur', shin: 'tibia', foot: 'second metatarsal bone' };

const PERFORATE = 0.2;          // J/mm2 of a bullet's face to break through bone: twice skin's 0.1 (Sellier and Kneubuehl)
const CLOT = 0.002;             // how fast a fracture's bleeding slows: what it loses in all is its rate over this
const FLOOR = 0;
const RAD = Math.PI / 180;

export type Break = {
    part: string; key: string; side: 'L' | 'R' | ''; type: string; how: string; ratio: number; where: string; end: number; s: number; hit: number;
    at: BABYLON.Vector3; dir: BABYLON.Vector3; owner: any; open: boolean; seg: any; count: number; level: string; text: string;
    place?: string; cut?: Cut; through?: boolean; wound?: any; out?: BABYLON.Vector3; tris?: (Tri & { bare?: boolean })[]; lines?: [Cut, (p: BABYLON.Vector3) => boolean][]; meshes?: BABYLON.Mesh[];
};

// A bone's kind, from its name (tools/anatomy.py keeps the source's names): what BONES has it under.
const KINDS: [RegExp, string][] = [[/ rib$/, 'rib'], [/cervical vertebra$|^atlas$|^axis$/, 'cervical vertebra'], [/thoracic vertebra$/, 'thoracic vertebra'],
    [/lumbar vertebra$/, 'lumbar vertebra'], [/^frontal bone$|parietal bone$|temporal bone$|^occipital bone$|^sphenoid bone$|^ethmoid$/, 'skull'],
    [/maxilla$|palatine bone$/, 'maxilla'], [/zygomatic bone$/, 'zygoma'], [/nasal bone$|lacrimal bone$|^vomer$/, 'nasal'], [/^mandible$/, 'jaw'],
    [/^hyoid bone$/, 'hyoid'], [/cartilage$/, 'larynx'], [/scaphoid$/, 'scaphoid'], [/(lunate|triquetral|pisiform|trapezium|capitate|hamate)$/, 'carpal'],
    [/metacarpal bone$/, 'metacarpal'], [/phalanx of .*(finger|thumb)$/, 'finger'], [/calcaneus$/, 'calcaneus'],
    [/(talus|cuboid bone|cuneiform bone|navicular bone of \w+ foot)$/, 'tarsal'], [/metatarsal bone$/, 'metatarsal'], [/phalanx of .*toe$/, 'toe'],
    [/patella$/, 'kneecap']];
const FACE_BONES = new Set(['maxilla', 'zygoma', 'nasal']);
const keyOf = (name: string) => KINDS.find(([re]) => re.test(name))?.[1] ?? name.replace(/^(left|right) /, '');
const sideOf = (name: string): 'L' | 'R' | '' => (/(^| )left /.test(name) ? 'L' : /(^| )right /.test(name) ? 'R' : '');
const NUMBER = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth', 'ninth', 'tenth', 'eleventh', 'twelfth'];
// A vertebra's level ('C5', 'T12', 'L1') or a rib's number, from its name.
const levelOf = (name: string) => {
    if (name === 'atlas') return 'C1';
    if (name === 'axis') return 'C2';
    const n = NUMBER.findIndex((w) => name.includes(w + ' ')) + 1;
    return / rib$/.test(name) ? `${n}` : `${name.includes('cervical') ? 'C' : name.includes('thoracic') ? 'T' : 'L'}${n}`;
};
const ribName = (side: string, n: number) => `${side} ${NUMBER[n - 1]} rib`;
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
    // How far the jaw hangs open, degrees, broken or out of its joints: the face (face.ts) lets it hang that far.
    declare jawHangs: number;
    declare teeth: Teeth;
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
        this.grain = new Map();
        this.damage = new Map();
        this.breaks = [];
        this.joints = new Map();
        this.meshes = [];
        this.epidural = null;
        this.jawHangs = 0;
        this.teeth = new Teeth(npc);
        this._vy = new Map();
        this._born = npc.world.frame;
        this._observer = npc.world.scene.onAfterPhysicsObservable.add(() => this.update());
    }

    // --- strength --------------------------------------------------------------------------

    // Two men of one age and size still differ, bone by bone, by a tenth or so either way.
    _grain(name: string) {
        if (!this.grain.has(name)) this.grain.set(name, 0.9 + Math.random() * 0.2);
        return this.grain.get(name);
    }

    // What bone `name` takes now in one way of loading it: 'moment' (N m, a shaft bent), 'bend' (N across a flat bone),
    // 'twist', 'ends' or 'axial'; `base` instead of the table's figure where the place on the bone decides it (the skull).
    strength(name: string, way: 'moment' | 'bend' | 'twist' | 'ends' | 'axial', base = 0) {
        const b = BONES[keyOf(name)];
        const figure = base || (b[way] ?? b.bend);
        const spongy = way === 'ends' || way === 'axial' || /vertebra|^atlas$|^axis$|sacrum|patella|calcaneus/.test(name);
        const cracked = 1 - 0.5 * (this.damage.get(name) ?? 0);
        return figure * (spongy ? this.spongy : this.cortical) * this.build * this._grain(name) * cracked;
    }

    // A load on bone `name`, `how` it came ('blow', 'fall', 'wrench'): `force` N across it over `area` cm2 (or, for a
    // long bone's shaft, `moment` N m bending it), `twist` N m about it, `axial` N along it, at `at` (world) going `dir`;
    // `end` 0 or 1 for a load on a long bone's end (a fall on the hip or the hand). Breaks it if it is more than the bone
    // takes, and cracks it a little if it comes near. The break, or null.
    load(name: string, how: string, { force = 0, moment = 0, area = 6.5, twist = 0, axial = 0, at = null, dir = null, end = -1 }:
        { force?: number; moment?: number; area?: number; twist?: number; axial?: number; at?: BABYLON.Vector3; dir?: BABYLON.Vector3; end?: number }) {
        const key = keyOf(name), b = BONES[key];
        if (!b || !this.npc.insides.parts.some((p) => p.name === name)) return null;
        const rest = this._rest(name, at, dir, end);
        // A shaft struck across is bent between the limb's two ends; the limb is not held at them, so the lever is an
        // eighth of its length rather than the quarter of a bone on two supports. That is for a narrow blow; one spread over
        // `c` of the limb's length bends it F (L - c) / 8 (the load over c against the limb's own inertia over L), so a wall
        // or the floor met flat along the whole of it bends it not at all and only crushes the flesh over it.
        if (b.long && rest.end < 0 && !moment) {
            const length = this._axis(name).length;
            moment = (force * Math.max(0, length - Math.sqrt(area) / 100)) / 8;
        }
        const spread = clamp((area / 6.5) ** 0.3, 0.6, 1.8);
        const across = b.long && rest.end < 0 ? moment / this.strength(name, 'moment')
            : force / (this.strength(name, end >= 0 ? 'ends' : 'bend', PLACES[rest.place]) * spread);
        const ways: [string, number][] = [['bend', across], ['twist', twist / this.strength(name, 'twist')], ['axial', axial / this.strength(name, 'axial')]];
        const [way, ratio] = ways.reduce((a, w) => (w[1] > a[1] ? w : a));
        if (ratio < 1) {
            // Miner's rule, roughly: a load at half the strength does a little harm, one near it a lot.
            if (ratio > 0.5) this.damage.set(name, Math.min(0.9, (this.damage.get(name) ?? 0) + 0.25 * ratio ** 4));
            return null;
        }
        let type = 'simple';
        // (A long bone's spongy end crumples rather than snapping: a fracture there, or one in pieces.)
        if (b.long && rest.end >= 0) type = ratio < 2 ? 'simple' : 'comminuted';
        else if (b.long) type = way === 'twist' ? 'spiral' : way === 'axial' ? 'oblique' : ratio < 1.6 ? (how === 'fall' ? 'oblique' : 'transverse') : ratio < 3 ? 'butterfly' : 'comminuted';
        else if (key === 'skull') type = rest.base ? 'basilar' : ratio > 1.8 && area < 15 ? 'depressed' : 'linear';
        else if (FACE_BONES.has(key)) type = this._face(key, rest.place, ratio, area, rest);
        else if (key === 'jaw') type = this._jaw(rest);
        else if (key === 'hyoid' || key === 'larynx') type = key;
        else if (/vertebra|sacrum/.test(key) && way === 'axial') type = ratio < 1.5 ? 'compression' : 'burst';
        else if (ratio > 2.2) type = 'comminuted';
        return this._break(name, type, how, ratio, rest);
    }

    // Something of `mass` kg at `speed` m/s along `dir` into segment `seg` at `point` (world): `tool` says what it is
    // (TOOLS' names) or how stiff it is (N/m); unsaid, a light fast thing is a bat and anything else a flat heavy thing.
    // The first bone in its way takes the force the flesh over it lets through; the chest is pushed in as a whole. A
    // blow breaks at most the one thing it lands on. Returns the force.
    impact(seg, point: BABYLON.Vector3, dir: BABYLON.Vector3, mass: number, speed: number, tool?: number | string) {
        const base = seg.name.replace(/[LR]$/, '');
        const what = typeof tool === 'string' ? TOOLS[tool] : tool !== undefined ? { k: tool, area: tool < 2e4 ? 40 : tool < 1e5 ? 30 : 25 } : mass < 1.2 && speed > 10 ? TOOLS.bat : TOOLS.flat;
        const behind = this.npc.ragdoll.mass * (STRUCK[base] ?? 0.05);
        const m = (mass * behind) / (mass + behind);
        if (base === 'chest' || base === 'belly') return this._chest(point, dir, what, mass, speed, 'blow');
        // A blow to the mouth meets the teeth first, through the lips (about 100 kN/m), over its own width.
        if (seg.name === 'head') {
            const lips = speed * Math.sqrt((1 / (1 / 100e3 + 1 / what.k)) * m);
            this.teeth.blow(point, dir, lips, Math.sqrt(what.area / Math.PI) / 100, this._mouthOpen() > 8);
        }
        const bone = this._struck(seg, point, dir);
        if (!bone) return 0;
        const k = 1 / (1 / BONES[keyOf(bone.name)].pad + 1 / what.k);
        const force = speed * Math.sqrt(k * m);
        if (this.load(bone.name, 'blow', { force, area: what.area, at: bone.at, dir })) return force;
        // Struck with the mouth open, a jaw that holds is knocked out of its joints instead.
        const key = keyOf(bone.name), half = force > 0.5 * this.strength(bone.name, 'bend') * clamp((what.area / 6.5) ** 0.3, 0.6, 1.8);
        if (key === 'jaw' && this._mouthOpen() > 12 && half) this._jawOut();
        // A finger or toe struck end on or across is put out of joint before its bone breaks.
        else if ((key === 'finger' || key === 'toe') && half && !this.joints.has(bone.name)) {
            this.joints.set(bone.name, 'dislocated');
            this.npc.vitals.pain = Math.min(1, this.npc.vitals.pain + 0.2);
            this.npc.vitals.injure(`${cap(bone.name.replace(/^\w+ phalanx of /, ''))} dislocated, bent out of line`, 2);
        }
        else this._atJoint(point, dir, force);
        return force;
    }

    // The chest pushed in by something of `mass` kg at `speed` along `dir`, landing on `tool`'s patch at `point`: how
    // far in, against how far this person's ribs go (a fifth of the chest's depth young, less with age: Kroell; Zhou's
    // age factors), says how many ribs break, whether a panel of them breaks loose, and whether the sternum goes.
    _chest(point: BABYLON.Vector3, dir: BABYLON.Vector3, tool: { k: number; area: number }, mass: number, speed: number, how: string) {
        const rd = this.npc.ragdoll, behind = rd.mass * 0.3, m = (mass * behind) / (mass + behind);
        const k = 1 / (1 / CHEST_STIFF + 1 / tool.k);
        const force = speed * Math.sqrt(k * m);
        const inward = force / CHEST_STIFF / CHEST_DEPTH;
        const onset = 0.2 * clamp(1 - 0.011 * (this.age - 30), 0.45, 1) * this._grain('ribs');
        const chest = rd.byName.get('chest'), v = this.npc.vitals;
        const front = V3.Dot(dir, chest.node.getDirection(V3.Forward())) < -0.5;
        this._commotio(point, dir, tool, speed, chest);
        // Not quite enough to break them, from the front: the ribs' cartilage is torn off the breastbone instead.
        if (inward < onset) {
            if (front && inward > 0.75 * onset && !this.joints.has('sternum')) {
                this.joints.set('sternum', 'torn');
                v.pain = Math.min(1, v.pain + 0.25);
                v.injure('Ribs torn from the breastbone: every breath hurts', 4);
            }
            return force;
        }
        const side = this._leftOf(point) ? 'left' : 'right';
        // As many ribs as it pushed in far enough, round the one it landed on, and no more than its width covers (a bat's
        // 6.5 cm, two or three). Past twice what breaks one, a run of three or more breaks in two places: a flail panel,
        // sucked in as the rest of the chest goes out (Kroell), with the lung bruised under it and torn by the ends.
        const ratio = inward / onset, count = clamp(1 + Math.floor((ratio - 1) * 4), 1, clamp(Math.round(Math.sqrt(tool.area) / 1.5), 1, 10));
        const from = clamp(this._ribAt(side, point, dir) - Math.floor((count - 1) / 2), 1, 13 - count);
        const flail = ratio >= 2 && count >= 3;
        for (let n = from; n < from + count; n++) this._break(ribName(side, n), flail ? 'flail' : 'simple', how, ratio, this._rest(ribName(side, n), point, dir), 0, 1, true);
        const s = side === 'left' ? 'L' : 'R';
        v.injure(count > 1 ? `${cap(side)} ribs ${from} to ${from + count - 1} broken${flail ? ', each in two places: flail chest' : ''}` : `${cap(side)} ${NUMBER[from - 1]} rib broken`, flail ? 7 : 5);
        if (flail) v.lungs[s] = Math.max(0.05, v.lungs[s] - 0.3);
        if (ratio > 1.8) { v.lungs[`leak${s}`] = true; this.npc.insides.hurt(`${side} lung`); v.injure(`Broken ribs tore the ${side} lung`, 7); }
        if (front && ratio > 1.5) this._break('sternum', 'simple', how, ratio, this._rest('sternum', point, dir));
        return force;
    }

    // The number of the rib a blow at `point` along `dir` lands on, on `side`: the first in its way, or the nearest.
    _ribAt(side: string, point: BABYLON.Vector3, dir: BABYLON.Vector3) {
        const own = (p) => p.name.startsWith(side) && / rib$/.test(p.name);
        const first = this.npc.insides.trace(point.subtract(dir.scale(0.15)), dir, 0.35, 0, own).spans[0];
        if (first) return Number(levelOf(first.part.name));
        let best = 6, near = Infinity;
        for (const part of this.npc.insides.parts.filter(own)) {
            const d = V3.Distance(V3.TransformCoordinates(V3.FromArray(part.source.centre), this.npc.restToWorld(part.owner)), point);
            if (d < near) { near = d; best = Number(levelOf(part.name)); }
        }
        return best;
    }

    // A hard, fast blow over the heart landing in the fifteen to thirty milliseconds before the T wave's peak sends a
    // normal heart into fibrillation (commotio cordis; Link 1998: 9 of 10 such hits): a thousandth or two of the cycle.
    _commotio(point: BABYLON.Vector3, dir: BABYLON.Vector3, tool: { k: number }, speed: number, chest) {
        const v = this.npc.vitals;
        if (speed < 8 || tool.k < 1e5 || !v.beating || !this._leftOf(point) || V3.Dot(dir, chest.node.getDirection(V3.Forward())) > -0.5) return;
        const window = 0.015 * (v.hr / 60);
        if (v.beat > 0.33 - window && v.beat < 0.33) {
            v.arrest('fibrillating');
            v.injure('Struck over the heart between beats: the heart is fibrillating', 10);
        }
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
            return { p, d, owner, s, end: end >= 0 ? end : s < 0.2 ? 0 : s > 0.8 ? 1 : -1, base: false, place: '' };
        }
        const centre = V3.FromArray(entries[0].source.centre);
        p = at ? V3.TransformCoordinates(at, toRest(owner)) : centre;
        d = dir ? V3.TransformNormal(dir, toRest(owner)).normalize() : new V3(0, -1, 0);
        const place = keyOf(name) === 'jaw' ? this._jawPlace(p) : this._place(name, p);
        // The skull's base: its floor (sphenoid), or the back of it below the eyes, where a fall on the back of the head lands.
        const base = place === 'base' || (place === 'back' && p.y < this.npc.person.byName['eye.L'].head.y - 0.03);
        return { p, d, owner, s: 0.5, end: -1, base, place };
    }

    // Which place on the head a point of bone `name` (rest space) is: round an eye (the person's own eye bones) it is
    // the eye socket, whatever bone it is; otherwise the vault's bones are its forehead, temples, sides, back and floor.
    _place(name: string, p: BABYLON.Vector3) {
        if (!/maxilla|zygomatic|frontal|nasal|lacrimal|ethmoid/.test(name)) return VAULT.find(([re]) => re.test(name))?.[1] ?? '';
        const eyes = ['eye.L', 'eye.R'].map((e) => this.npc.person.byName[e].head);
        if (eyes.some((e) => Math.abs(p.x - e.x) < 0.02 && Math.abs(p.y - e.y) < 0.022 && p.z > e.z - 0.035)) return 'eye';
        return VAULT.find(([re]) => re.test(name))?.[1] ?? '';
    }

    // Which part of the jaw: its chin, its body along the teeth, its angle below the ear, or its condyle in the joint.
    _jawPlace(p: BABYLON.Vector3) {
        const joint = this.npc.person.byName['jaw'].head;
        if (V3.Distance(p, joint) < 0.03 || p.y > joint.y - 0.015) return 'condyle';
        if (Math.abs(p.x) < 0.018) return 'chin';
        return p.z < joint.z + 0.03 ? 'angle' : 'body';
    }

    // A break of a bone of the face (`key`) from a blow at `place` on it: the nose; an eye socket's floor blown out by
    // something broad pressing the eye in; the cheekbone; or the upper jaw broken off at one of Le Fort's three levels,
    // by how high and how hard.
    _face(key: string, place: string, ratio: number, area: number, rest) {
        if (place === 'eye' && area >= 20) return 'blowout';
        if (key === 'nasal') return 'nasal';
        if (key === 'zygoma') return 'zygoma';
        // Struck low, at the mouth, it goes above the teeth (I); across the nose, through it (II); and only a very heavy blow
        // high on the face takes the whole of it off the skull (III).
        const low = rest.p.y < this.npc.person.byName['eye.L'].head.y - 0.045;
        return low ? (ratio > 3 ? 'lefort2' : 'lefort1') : ratio > 3 ? 'lefort3' : 'lefort2';
    }

    // How the jaw breaks where it was struck: at the chin the force goes up both sides to the condyles, which break.
    _jaw(rest) { return rest.place === 'chin' && Math.random() < 0.5 ? 'condyles' : rest.place; }

    // The first bone in a blow's way into segment `seg` at `point` along `dir`, or the bone under that segment.
    _struck(seg, point: BABYLON.Vector3, dir: BABYLON.Vector3) {
        // A blow to the head reaches the skull and jaw and no further (not the neck behind them); a blow anywhere reaches
        // the bones under that skin, never the spine at the back of the trunk.
        const head = seg.name === 'head';
        const bony = (p) => p.kind === 'bone' || p.kind === 'skull' || p.kind === 'cartilage';
        const ofHead = (p) => p.kind === 'skull' || /maxilla|zygomatic|nasal|lacrimal|palatine|vomer|mandible|hyoid|cartilage/.test(p.name);
        const reach = (p) => bony(p) && !/vertebra|^atlas$|^axis$|sacrum/.test(p.name) && (head ? ofHead(p) : !ofHead(p));
        const { spans } = this.npc.insides.trace(point.subtract(dir.scale(0.15)), dir, head ? 0.3 : 0.4, 0, reach);
        const first = spans[0];
        if (first) return { name: first.part.name, at: point.subtract(dir.scale(0.15)).add(dir.scale(first.enter)) };
        const under = UNDER[seg.name.replace(/2?[LR]$/, '')];
        if (!under) return null;
        const side = seg.name.endsWith('L') ? 'left ' : seg.name.endsWith('R') ? 'right ' : /hip/.test(under) ? (this._leftOf(point) ? 'left ' : 'right ') : '';
        return { name: side + under, at: point };
    }

    // Whether a world point is on the person's left.
    _leftOf(point: BABYLON.Vector3) {
        const pelvis = this.npc.ragdoll.byName.get('pelvis');
        return V3.Dot(point.subtract(pelvis.node.position), pelvis.node.getDirection(V3.Right())) < 0;
    }

    // --- a break ------------------------------------------------------------------------------

    _break(name: string, type: string, how: string, ratio: number, rest, calibre = 0, count = 1, quiet = false) {
        const key = keyOf(name), b = BONES[key], side = sideOf(name);
        const br: Break = { part: name, key, side, type, how, ratio, where: '', end: rest.end, s: rest.s, hit: rest.s, at: rest.p, dir: rest.d, owner: rest.owner,
            open: how === 'shot', seg: null, count, level: '', text: '' };
        if (b.long) br.where = rest.end < 0 ? 'shaft' : ENDS[key][rest.end][0];
        // A shaft that lets go parts at the ragdoll's mid joint, the only place the limb and its skin can bend: drawn far
        // from it, the bone would part in one place and the leg bend in another, and the bone's end would stand out of the
        // leg. So it parts within a few centimetres of the middle; a bullet's pieces stay where the bullet went.
        if (br.where === 'shaft' && UNSTABLE.has(type)) br.s = clamp(br.s, 0.45, 0.55);
        // A second break of a bone already broken there makes the first worse, not a new one.
        const same = this.breaks.find((o) => o.part === name && o.where === br.where && (b.long ? Math.abs(o.s - br.s) < 0.15 : o.type === type && V3.Distance(o.at, br.at) < 0.04));
        if (same && !b.long) return same;
        if (same) {
            if (UNSTABLE.has(type) && GIVE[type][0] > (GIVE[same.type]?.[0] ?? 0) && same.seg) { same.type = type; this._loosen(same); }
            return same;
        }
        if (/rib|vertebra/.test(key)) br.level = levelOf(name);
        br.place = rest.place;
        this.breaks.push(br);
        this.npc.insides.hurt(name);
        this._body(br);
        this._draw(br, calibre);
        this._partner(br);
        br.text = this._words(br);
        if (!quiet) this.npc.vitals.injure(br.text, /femur|hip|vertebra|skull|sacrum|larynx/.test(key) ? 7 : 5);
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

    _words(br: Break) {
        const named = cap(br.part), side = br.at.x < 0 ? 'left' : 'right';
        if (FACE[br.type]) return FACE[br.type].replace('$side', side).replace('$Side', cap(side));
        if (br.key === 'rib') return `${named} broken${br.type === 'flail' ? ' in two places' : ''}`;
        if (br.level) return `${named} (${br.level}): ${WORDS[br.type] ?? 'fracture'}`;
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
            case 'rib': {
                // Every breath hurts and is held short. (A run of them, a flail panel and a torn lung are _chest's.)
                const s = side || 'R';
                v.lungs[s] = Math.max(0.05, v.lungs[s] - 0.03);
                if (br.how === 'shot') { v.lungs[`leak${s}`] = true; npc.insides.hurt(`${wordOf(s)} lung`); }
                return;
            }
            case 'sternum':
                if (br.ratio > 2) { v.pump = Math.max(0, v.pump - 0.12); v.injure('Heart bruised against the spine', 6); }
                return;
            case 'clavicle': {
                // The strut that holds the shoulder out is gone: the shoulder drops forward and down, and the arm hangs.
                const arm = rd.byName.get('upperarm' + side);
                if (arm) arm.broken = true;
                v.injure(`The ${wordOf(side)} shoulder drops forward and down`, 3);
                return;
            }
            case 'scapula':
                return;
            case 'skull':
            case 'maxilla':
            case 'zygoma':
            case 'nasal':
                return this._skull(br);
            case 'hyoid':
            case 'larynx':
                // The voice box crushed swells shut over the next minutes; the hyoid less so.
                v.airway = Math.max(0.1, v.airway - (br.key === 'larynx' ? 0.45 : 0.2));
                v.bleed({ name: br.part, rate: 0.0003, internal: true, clots: 0.01, into: 'airway' });
                return;
            case 'jaw':
                return this._jawBroken(br);
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
            case 'calcaneus':
            case 'tarsal':
                // A broken heel or talus takes no weight, whatever broke it (a shot through it as much as a fall on it).
                npc.legGone = true;
                return;
        }
        if (/vertebra/.test(br.key)) this._spine(br);
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
        if (FACE[br.type]) return this._faceBroken(br);
        v.concussion = Math.min(1, v.concussion + 0.3 + 0.2 * br.ratio);
        // Over the temple the bone is thinnest and the middle meningeal artery runs in a groove on its inside: a break
        // there tears it, and the blood collects between bone and brain, a lucid interval, then the brain is pressed.
        if (br.place === 'temple' && !this.epidural) {
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

    // A face broken: a nose bleeds from the nostrils, the upper jaw's breaks bleed into the mouth and nose, and the higher
    // Le Fort breaks let the middle of the face fall back onto the airway and leak brain fluid from the nose.
    _faceBroken(br: Break) {
        const v = this.npc.vitals;
        v.concussion = Math.min(1, v.concussion + 0.1 + (br.type === 'lefort3' ? 0.4 : 0));
        if (br.type === 'nasal' || br.type === 'lefort2' || br.type === 'lefort3') {
            v.bleed({ name: 'nose', rate: br.type === 'nasal' ? 0.0004 : 0.0012, clots: 0.006, source: { mark: this._skinOver(br) }, into: 'nose' });
        }
        if (br.type.startsWith('lefort')) this.teeth.loosen(true);
        if (br.type === 'lefort1' || br.type === 'lefort2') v.bleed({ name: 'mouth', rate: 0.0006, clots: 0.006, internal: true, into: 'mouth' });
        if (br.type === 'lefort2') v.airway = Math.max(0.2, v.airway - 0.15);
        if (br.type === 'lefort3') {
            v.airway = Math.max(0.2, v.airway - 0.35);
            v.injure('Clear fluid running from the nose', 6);
        }
    }

    // A jaw broken: it hangs a little and will not close true; broken on both sides (or at both joints) it hangs further
    // and the tongue, with nothing in front to hold it, falls back onto the airway. A break along the teeth is open into
    // the mouth and bleeds there.
    _jawBroken(br: Break) {
        const v = this.npc.vitals, both = br.type === 'condyles' || br.ratio > 2.2;
        this.jawHangs = Math.max(this.jawHangs, both ? 18 : 10);
        if (both) { v.airway = Math.max(0.2, v.airway - 0.2); v.injure('The broken jaw lets the tongue fall back', 6); }
        if (br.type === 'body' || br.type === 'chin') this.teeth.loosen(false);
        if (br.type === 'body' || br.type === 'chin') v.bleed({ name: 'mouth', rate: 0.0004, clots: 0.008, internal: true, into: 'mouth' });
    }

    // A jaw knocked out of its joints with the mouth open: it locks open and cannot be closed.
    _jawOut() {
        if (this.joints.has('jaw')) return;
        this.joints.set('jaw', 'dislocated');
        this.jawHangs = Math.max(this.jawHangs, 28);
        this.npc.vitals.pain = Math.min(1, this.npc.vitals.pain + 0.3);
        this.npc.vitals.injure('Jaw dislocated: locked open', 5);
    }

    // How far the mouth is open now, degrees: the jaw bone's turn from where it rests.
    _mouthOpen() {
        const bone = this.npc.person.byName['jaw'].bone, rest = new Q();
        bone.getRestPose().decompose(undefined, rest, undefined);
        const now = bone.rotationQuaternion ?? Q.FromRotationMatrix(bone.getLocalMatrix());
        return (2 * Math.acos(Math.min(1, Math.abs(Q.Dot(rest, now)))) * 180) / Math.PI;
    }

    // The skin over break `br` (a crossing, as npc.surface gives): where blood from it comes out.
    _skinOver(br: Break) {
        const at = V3.TransformCoordinates(br.at, this.npc.restToWorld(br.owner)), out = V3.TransformNormal(br.dir, this.npc.restToWorld(br.owner)).normalize().scale(-1);
        return this.npc.surface(at.add(out.scale(0.08)), out.scale(-1), 0.12).find((h) => h.kind === 'skin') ?? null;
    }

    _spine(br: Break) {
        const npc = this.npc, v = npc.vitals, rd = npc.ragdoll;
        const joint = rd.byName.get(br.key === 'cervical vertebra' ? 'head' : br.key === 'lumbar vertebra' ? 'belly' : 'chest');
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
        if (br.key === 'rib') {
            // Broken where the blow landed: a cut down through it across its run; in a flail panel broken in two places, the
            // piece between pushed in.
            const t = across(V3.Cross(V3.Up(), n), new V3(n.z, 0, -n.x)), other = c.add(t.scale(0.07));
            const ribs = (p: BABYLON.Vector3) => V3.Distance(p, c) < 0.15;
            const look: Look = { take: ribs, cut: plane(t, 0.003), near: ribs, lines: [] };
            if (br.type === 'flail') {
                look.lines.push([plane(t, 0.003, other), ribs]);
                look.chunk = (p) => (ribs(p) && V3.Dot(p.subtract(c), t) > 0.004 && V3.Dot(p.subtract(other), t) < -0.004 ? 0 : -1);
                look.move = () => ({ shift: n.scale(0.01), turn: Q.Identity() });
            }
            return look;
        }
        if (/vertebra|sacrum/.test(br.key)) {
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

    // A segment that was coming down and has just been stopped by the floor: what it landed on takes the force. What
    // the body lowers under its own control is not a fall (a foot set down in a step, a knee bent to sit): while a
    // part's muscles are working on it they take the first 3 m/s of its landing, and only what is left over counts.
    // The hip, a hand put out and the feet are counted whole, with their own tests.
    _falls(settling: boolean) {
        const rd = this.npc.ragdoll;
        for (const seg of rd.segments) {
            seg.body.getLinearVelocityToRef(_v);
            const before = this._vy.get(seg) ?? 0;
            this._vy.set(seg, _v.y);
            // (Stopped: it lost most of the speed it had downward, in one step, at the floor.)
            // (On whatever is under it: the floor, or a ledge it came down on.)
            const low = rd.lowest(seg), under = this.npc.world.ground?.(seg.node.position.x, seg.node.position.z, low + 0.1) ?? FLOOR;
            if (settling || before > -2.5 || _v.y < before * 0.4 || low > under + 0.06) continue;
            this._land(seg, _v.y - before);
        }
    }

    // Segment `seg` stopped by the floor, its speed changed by `dv` m/s.
    _land(seg, dv: number) {
        const rd = this.npc.ragdoll, base = seg.name.replace(/[LR]$/, ''), side = seg.name.endsWith('L') ? 'L' : 'R', word = wordOf(side);
        if (!(base in LANDING)) return;
        const held = seg.motor?.on && base !== 'pelvis' && base !== 'hand' && base !== 'foot';
        if (held) dv -= 3;
        if (dv < 0.5) return;
        const m = rd.mass * LANDING[base];
        const at = rd.worldPoint(seg, seg.centre, new V3());
        at.y = rd.lowest(seg);
        const down = new V3(0, -1, 0);
        // Which side is down, for a body landing on its side: its right is pointing up or down.
        const onSide = (s) => { const r = s.node.getDirection(V3.Right()); return Math.abs(r.y) > 0.55 ? (r.y > 0 ? 'left' : 'right') : null; };
        switch (base) {
            case 'head': return this._headDown(seg, dv, at);
            case 'pelvis': {
                // On the side, the greater trochanter takes it and the femur's neck behind it is what breaks in the old.
                // Sat down hard, the buttocks give (about 30 kN/m) and half of what is left goes up the spine: the old crush
                // a lumbar vertebra.
                const low = onSide(seg);
                if (low) this.load(`${low} femur`, 'fall', { force: dv * Math.sqrt(71e3 * m), at, dir: down, end: 0 });
                else if (dv > 3.5) this.load('first lumbar vertebra', 'fall', { axial: 0.5 * dv * Math.sqrt(30e3 * m) });
                return;
            }
            case 'chest':
                if (onSide(seg)) this._chest(at, down, { k: 5e6, area: 300 }, m, dv, 'fall');
                return;
            // A fall onto the outstretched hand: the end of the radius (Colles'), in the old.
            case 'hand':
                rd.byName.get('pelvis').body.getLinearVelocityToRef(_w);
                // (A young man's radius holds, and the scaphoid behind the thumb breaks instead.)
                // (What it brings down is the body's speed, not the hand's: a hand is light and flung faster than the fall.)
                if (-_w.y > dv * 0.5) {
                    const force = Math.min(dv, -_w.y) * Math.sqrt(100e3 * m);
                    if (!this.load(`${word} radius`, 'fall', { force, at, dir: down, end: 1 })) this.load(`${word} scaphoid`, 'fall', { force, at, dir: down });
                }
                return;
            case 'foot': {
                // Feet first from a height, the hips over them: the knees and the heel pad take most of it (30 kN/m all
                // told), the heel bursts past about 7 kN, the shin's lower end past 16 kN, and from higher still what is
                // left goes up the spine and crushes a lumbar vertebra. A step or a jump off a chair is nothing like that.
                rd.byName.get('pelvis').body.getLinearVelocityToRef(_w);
                const upright = rd.byName.get('pelvis').node.position.y - seg.node.position.y > 0.6 && -_w.y > dv * 0.5;
                if (!upright || dv < 4) return;
                const force = dv * Math.sqrt(30e3 * m);
                this.load(`${word} calcaneus`, 'fall', { axial: force, at, dir: down });
                this.load(`${word} tibia`, 'fall', { axial: force, at, dir: down, end: 1 });
                if (dv > 6) this.load('first lumbar vertebra', 'fall', { axial: force * 0.5 });
            }
        }
    }

    // The head stopped by the floor, unprotected: whether the skull breaks is the speed it hit at against the speeds
    // that broke cadaver skulls dropped onto steel (Gurdjian: the forehead 4.6 m/s, the back 4.9, the side 5.6-5.8),
    // scaled by this skull's strength. Head first with the body coming down on top of it, the neck is crushed along its
    // length as well (a diver's burst fracture: the neck holds about 2.2 kN).
    _headDown(seg, dv: number, at: BABYLON.Vector3) {
        // The bone it landed on: the first of the skull up from the floor where it touched.
        const rd = this.npc.ragdoll, up = new V3(0, 1, 0);
        const first = this.npc.insides.trace(at.subtract(up.scale(0.03)), up, 0.2, 0, (p) => p.kind === 'skull').spans[0];
        const name = first?.part.name ?? 'occipital bone', rest = this._rest(name, at, up.scale(-1));
        const speed = DROP[rest.place] ?? DROP.back;
        const strong = this.strength(name, 'bend', PLACES.side) / PLACES.side;
        const ratio = (dv / speed) ** 2 / strong;
        if (ratio >= 1) this._break(name, rest.base ? 'basilar' : 'linear', 'fall', ratio, rest);
        const chest = rd.byName.get('chest');
        chest.body.getLinearVelocityToRef(_w);
        if (rd.byName.get('pelvis').node.position.y > seg.node.position.y + 0.5 && -_w.y > dv * 0.6) {
            const axial = dv * Math.sqrt(100e3 * rd.mass * 0.3);
            // Short of bursting the vertebra, the neck buckles forward and its facets ride over each other and lock.
            if (!this.load('fifth cervical vertebra', 'fall', { axial }) && axial > 0.6 * this.strength('fifth cervical vertebra', 'axial')) this._facets(axial > 0.8 * this.strength('fifth cervical vertebra', 'axial'));
        }
    }

    // The facet joints between the fifth and sixth neck vertebrae dislocated: one side out locks the head turned and
    // stiff; both out lets the vertebra slide forward over the next, which bruises or cuts the cord.
    _facets(both: boolean) {
        if (this.joints.has('facets')) return;
        this.joints.set('facets', both ? 'dislocated' : 'locked');
        const v = this.npc.vitals, neck = this.npc.ragdoll.byName.get('head');
        v.pain = Math.min(1, v.pain + 0.4);
        if (both) {
            this._widen(neck, [0, 2], 0.3);
            v.injure('Neck facets dislocated at C5-C6 on both sides: the vertebra slid forward', 8);
            this.cord('C5');
        } else {
            const a = this.npc.ragdoll.angles(neck, [0, 0, 0]);
            this._range(neck, a.map((x) => x - 0.15), a.map((x) => x + 0.15));
            v.injure('Neck facet locked out at C5-C6: the head held turned and stiff', 5);
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
                // (Struck, a shoulder or elbow is driven out only well past what holds it: they go out by leverage.)
                if (torque > holds * 3) this._dislocate(seg, `${joint} dislocated`);
                return;
            case 'facets':
                if (torque > holds * 2) this._facets(torque > holds * 3);
                return;
            case 'wrist':
                // Bent back past its range, the wrist breaks the radius's end (the lever is the 3 cm to the carpus), or sprains.
                if (!this.load(`${word} radius`, 'wrench', { force: torque / 0.03, end: 1 })) this._tear(seg, axis, joint, 0.3);
                return;
            case 'torn':
                // A knee forced well past its range comes apart altogether, and takes the artery behind it.
                if (base === 'shin' && torque > holds * 2.5) {
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
            // (A clean transverse break has to be pushed further out of line before an end gets through.)
            if (bend > BONES[br.key].open * (br.type === 'transverse' ? 1.5 : 1)) this._through(br);
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
        this.teeth.dispose();
    }
}
