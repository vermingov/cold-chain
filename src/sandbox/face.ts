// A face that shows what is happening to the person behind it.
//
// The rig is MakeHuman's own face (tools/people.py): every bone of it, and its
// face pose units, sixty unit poses of those bones each made by one muscle's
// pull, carried in the person's file as each bone's turn (`header.face`). A face
// here is a weighted mix of units blended as MakeHuman blends them (each unit's
// turn scaled by its weight, the turns multiplied together), and the mix is
// written in the units of the Facial Action Coding System (Ekman & Friesen 1978,
// FACS; Ekman, Friesen & Hager 2002): AU1 inner brow raiser, AU4 brow lowerer,
// AU6 cheek raiser, and so on (AUS below says which pose units make each one).
// Brows, lashes and the hairline hang from the skin's own vertices and move with
// it; the swelling (bruise.ts) and the wounds (marks.ts) are drawn in the skin's
// rest space and go wherever the skin goes.
//
// What the face shows, and from what:
// - Pain: the four movements that carry nearly all the information about pain
//   in the face (Prkachin 1992; Prkachin & Solomon 2008, whose PSPI score is
//   AU4 + max(AU6, AU7) + max(AU9, AU10) + AU43): brows lowered and drawn
//   together, cheeks raised and lids tightened, nose wrinkled and upper lip
//   raised, eyes shut, as much as it hurts; strongest as a fresh hurt comes and
//   easing into a lasting ache (the pain face is brief: Prkachin 1992; Craig &
//   Patrick 1985).
// - Fear: brows raised and drawn together, upper lids raised, lips stretched
//   back, the jaw dropped (AU1+2+4+5+20+26: Ekman & Friesen 1975, 1978), from
//   a weapon pointed at them, a shot or a blast nearby (a startle first: a blink
//   and a flinch of the face, Landis & Hunt 1939), being hurt, and the anxiety
//   of losing blood (ATLS class II-III haemorrhage: anxious, then confused).
// - The voice: the mouth opened by the recording itself as it plays, the face
//   that goes with each kind of cry: a scream's wide jaw with the pain face, a
//   yell, a groan with the eyes screwed up, weeping (AU1+4+6+15+17, the mouth
//   open with the sobs), a gasp, a cough, a last breath.
// - Air hunger: mouth breathing, the jaw opening with each breath in.
// - Shock: the face goes slack as the brain runs short of blood: expressions
//   blunted, lids heavy, the jaw open, the eyes unfocused and slow, blinks slow
//   and long (drowsy blinks: Caffier, Erdmann & Ullsperger 2003), the skin pale.
// - Out cold: lids nearly shut or a little open, the eyes roving slowly under
//   them and turned up (Bell's phenomenon), the jaw falling open as gravity
//   takes it, no blinking.
// - Dead: no blinking, lids part open, the eyes fixed and drifted out to their
//   resting divergence, the jaw dropping (primary flaccidity), the pupils going
//   to mid-dilated and fixed (4-6 mm: Wijdicks 2001 on brain death), the skin
//   pale (pallor mortis).
// - Eyes, awake: both turned on the same point (they converge on it) and kept
//   there as the head moves, moving between points in saccades whose duration
//   follows the main sequence (about 21 ms + 2.2 ms a degree: Carpenter 1988;
//   Baloh et al. 1975), with microsaccades between (Martinez-Conde, Macknik &
//   Hubel 2004), the upper lid following the eye up and down (MakeHuman's eye
//   units carry the lids with them). Looking at the player (the one near them,
//   and the threat), at a fresh wound, away now and then.
// - Blinks: about 17 a minute at rest (Bentivoglio et al. 1997), more when
//   frightened or hurting (Harrigan & O'Connell 1996), closing in ~80 ms and
//   opening over ~170 ms (VanderWerf et al. 2003). Swollen lids close as far as
//   the swelling has come (bruise.ts).
// - Pupils: ~3.5 mm in a lit room, wider with fear and pain (sympathetic; the
//   pupil dilates to pain: Larson et al. 1993), with hypoxia, and once dead.
// Sources and numbers: dev/research/faces.md.

import * as BABYLON from '@babylonjs/core';
import { Eyes } from './eyes.ts';
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion, RAD = Math.PI / 180;

const WINDOW = 0.03;        // seconds of the voice the mouth is opened by, at each moment
const JAW_UNIT = 20.2;      // degrees the jaw turns in MakeHuman's JawDrop unit (the face's opening is given in degrees)

// Each action unit as MakeHuman pose units: '*' is Left and Right in turn (the person's own sides), each at the weight
// given. The weights were set by eye against FACS's descriptions of each unit at full (E) intensity, from close renders.
// AU5 (upper lid raiser), AU7 (lid tightener), AU43 (eyes closed) and the jaw (AU25-27) are worked out with the lids and
// the jaw below, where they meet the blink, the gaze and the voice.
const AUS: Record<string, [string, number][]> = {
    AU1: [['*InnerBrowUp', 0.9]],
    AU2: [['*OuterBrowUp', 0.9]],
    AU4: [['*BrowDown', 1], ['NoseWrinkler', 0.25]],
    AU6: [['*CheekUp', 0.7]],
    AU9: [['NoseWrinkler', 0.8], ['UpperLipUp', 0.3], ['NasolabialDeepener', 0.4]],
    AU10: [['UpperLipUp', 0.8], ['NasolabialDeepener', 0.6]],
    AU12: [['Mouth*PullUp', 0.5]],
    AU15: [['Mouth*PullDown', 0.6]],
    AU16: [['lowerLipDown', 0.5]],
    AU17: [['lowerLipUp', 0.5], ['ChinForward', 0.4]],
    AU20: [['Mouth*PullSide', 0.6], ['Mouth*Platysma', 0.25]],
    AU24: [['lowerLipUp', 0.4], ['UpperLipBackward', 0.25]],
    AU27: [['JawDropStretched', 0.6]],
};
const LIDS = ['AU5', 'AU7', 'AU43'], ALL = [...Object.keys(AUS), ...LIDS];
// (each '*' unit as its two sides, worked out once)
const SIDES = (unit: string) => (unit.includes('*') ? [unit.replace('*', 'Left'), unit.replace('*', 'Right')] : [unit]);
const MIX = Object.entries(AUS).flatMap(([au, parts]) => parts.flatMap(([unit, x]) => SIDES(unit).map((u) => [au, u, x] as const)));

// The cries (npc.say's kinds): the face each makes, held while it sounds, and how far the jaw opens (degrees) at the
// recording's loudest. A scream is the pain face at its height with the mouth stretched open; weeping the sad face.
const CRIES: Record<string, { face: Record<string, number>; jaw: number }> = {
    scream: { face: { AU4: 0.9, AU6: 0.9, AU7: 0.8, AU9: 0.7, AU10: 0.9, AU16: 0.6, AU20: 0.7, AU27: 0.8, AU43: 0.4 }, jaw: 30 },
    yell: { face: { AU4: 0.8, AU7: 0.5, AU10: 0.6, AU16: 0.4, AU20: 0.4, AU27: 0.3 }, jaw: 24 },
    groan: { face: { AU4: 0.7, AU6: 0.6, AU7: 0.7, AU15: 0.3, AU20: 0.4, AU43: 0.5 }, jaw: 9 },
    cry: { face: { AU1: 1, AU4: 0.4, AU6: 0.6, AU7: 0.4, AU15: 1, AU17: 0.6, AU20: 0.3, AU43: 0.2 }, jaw: 16 },
    gasp: { face: { AU1: 0.6, AU2: 0.5, AU5: 0.3, AU16: 0.3, AU20: 0.2 }, jaw: 24 },
    cough: { face: { AU4: 0.6, AU6: 0.6, AU7: 0.7, AU43: 0.7 }, jaw: 20 },
    dying: { face: {}, jaw: 18 },
};
// How a pain face is made, by how much it hurts (0 to 1, PSPI's units scaled): brow lowering and orbital tightening
// first, the levator (nose wrinkle, upper lip) as it gets worse, the eyes shut at its worst, and only while the hurt is
// fresh (`flare`): nobody keeps their eyes screwed shut through a lasting pain.
const PAIN = (p: number, flare: number) => ({ AU4: p, AU6: p * 0.9, AU7: p, AU9: ramp(p, 0.25, 0.8), AU10: ramp(p, 0.25, 0.8) * 0.9,
    AU20: ramp(p, 0.35, 0.9) * 0.6, AU43: ramp(Math.min(p, flare), 0.5, 1) * 0.8, AU24: ramp(p, 0.1, 0.5) * 0.3 * (1 - ramp(p, 0.6, 0.9)) });
const FEAR = (f: number) => ({ AU1: f, AU2: f * 0.8, AU4: f * 0.45, AU5: f, AU20: f * 0.8, AU26: f * 0.35 });

const MM_IRIS = 11.7;       // mm across a grown iris; the pupil is given in mm and drawn as its share of the iris

function ramp(x: number, a: number, b: number) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }
function clamp(x: number, lo = 0, hi = 1) { return Math.max(lo, Math.min(hi, x)); }
// A number that drifts back and forth for its own reasons (slow noise: sums of sines at unrelated rates).
function wander(t: number, seed: number) { return (Math.sin(t * 0.71 + seed) + Math.sin(t * 0.37 + seed * 2.3) * 0.7 + Math.sin(t * 1.13 + seed * 0.7) * 0.4) / 2.1; }

type Part = { slot: number; axis: BABYLON.Vector3; angle: number };

// The units out of a person's file, made once per body: each as the bones (slots) it turns, about which axis, how far.
const compiled = new WeakMap<object, { slots: string[]; units: Map<string, Part[]> }>();
function compile(header) {
    if (compiled.has(header)) return compiled.get(header);
    const slots: string[] = [], units = new Map<string, Part[]>();
    for (const [name, bones] of Object.entries(header.face ?? {}) as [string, Record<string, number[]>][]) {
        units.set(name, Object.entries(bones).map(([bone, [x, y, z, w]]) => {
            if (!slots.includes(bone)) slots.push(bone);
            const s = Math.hypot(x, y, z);
            return { slot: slots.indexOf(bone), axis: new V3(x / s, y / s, z / s), angle: 2 * Math.atan2(s, w) };
        }));
    }
    const out = { slots, units };
    compiled.set(header, out);
    return out;
}

const _q = new Q(), _d = new Q(), _m = new BABYLON.Matrix(), _inv = new BABYLON.Matrix(), _v = new V3();

export class Face {
    declare npc: any;
    declare person: any;
    // How far each eye's lids have swollen shut, 0 to 1 (bruise.ts).
    declare swollen: { L: number; R: number };
    declare voice: any;
    declare kind: string;
    declare now: () => number;
    declare bones: BABYLON.Bone[];
    declare units: Map<string, Part[]>;
    declare weights: Map<string, number>;
    declare au: Record<string, number>;
    declare quats: Float64Array;
    declare jaw: number;
    declare blink: number;
    declare gaze: { L: number[]; R: number[]; from: { L: number[]; R: number[] }; t: number; length: number; target: string; next: number; micro: number[]; microAt: number; spot: BABYLON.Vector3 | null };
    declare clock: number;
    declare seed: number;
    declare state: { pain: number; flare: number; fear: number; startle: number; flash: number; breath: number; slack: number; deadFor: number; pupil: number; pale: number; lastPain: number; nextBlink: number; blinkT: number; blinkLong: number; deadLids: number };
    declare eyeRest: { L: BABYLON.Vector3; R: BABYLON.Vector3; head: BABYLON.Vector3 };
    declare eyeUnits: Record<string, number>;
    declare eyeMaterial: BABYLON.PBRMaterial | null;
    declare pupil: PupilLayer | null;
    // The eyes' own hurts: wounds, blood in and on them, blindness (eyes.ts).
    declare eyes: Eyes;

    constructor(npc) {
        this.npc = npc;
        const person = (this.person = npc.person);
        this.swollen = { L: 0, R: 0 };
        this.voice = null;
        this.kind = '';
        this.now = () => 0;
        const { slots, units } = compile(person.header);
        this.bones = slots.map((n) => person.byName[n].bone);
        this.units = units;
        this.weights = new Map();
        this.au = Object.fromEntries(ALL.map((k) => [k, 0]));
        this.quats = new Float64Array(slots.length * 4);
        this.jaw = 0;
        this.blink = 0;
        this.clock = 0;
        this.seed = Math.random() * 100;
        this.gaze = { L: [0, 0], R: [0, 0], from: { L: [0, 0], R: [0, 0] }, t: 1, length: 0, target: 'player', next: 0.5, micro: [0, 0], microAt: 0, spot: null };
        this.state = { pain: 0, flare: 0, fear: 0, startle: 0, flash: npc.world?.weapons?.flashAt ?? 0, breath: 0, slack: 0, deadFor: 0, pupil: 3.5, pale: 0, lastPain: 0, nextBlink: 1 + Math.random() * 3,
            blinkT: -1, blinkLong: 1, deadLids: 0.45 + Math.random() * 0.35 };
        const by = person.byName;
        this.eyeRest = { L: by['eye.L'].head, R: by['eye.R'].head, head: by.head.head };
        // How far (degrees) each eye unit turns its eye: a gaze in degrees is that share of the unit.
        this.eyeUnits = {};
        for (const side of ['Left', 'Right']) for (const way of ['EyeturnLeft', 'EyeturnRight', 'EyeUp', 'EyeDown']) {
            const parts = units.get(side + way) ?? [];
            const eye = parts.find((p) => slots[p.slot] === `eye.${side[0]}`);
            this.eyeUnits[side + way] = eye ? eye.angle / RAD : 20;
        }
        this.eyeMaterial = null;
        this.pupil = null;
        this._eyes();
    }

    // This person's own eyes, wet: the room's reflection in them (the probe the wet things share) and a pupil that
    // widens and narrows (PupilLayer). The shared eye material is left as it was.
    _eyes() {
        const p = this.person, mm = p.mesh.material as BABYLON.MultiMaterial, i = p.header.parts.findIndex((x) => x.kind === 'eyes');
        if (i < 0 || !mm?.subMaterials) { this.eyes = new Eyes(this.npc, null, IRISES.brown); return; }
        const shared = mm.subMaterials[i] as BABYLON.PBRMaterial, scene = p.scene;
        const m = shared.clone(`${shared.name}:${p.mesh.name}`) as BABYLON.PBRMaterial;
        // The tear film is smoother than anything else on a body: a sharp catchlight of every lamp and the room behind.
        m.roughness = 0.04;
        m.reflectionTexture = (scene.getMaterialByName('dropBlood') as BABYLON.PBRMaterial)?.reflectionTexture ?? null;
        m.environmentIntensity = m.reflectionTexture ? 0.7 : 0;
        const file = p.header.parts[i].texture?.file ?? '';
        const iris = IRISES[Object.keys(IRISES).find((k) => file.includes(k)) ?? 'brown'];
        this.pupil = new PupilLayer(m, iris);
        mm.subMaterials[i] = m;
        this.eyeMaterial = m;
        this.eyes = new Eyes(this.npc, m, iris);
    }

    dispose() {
        this.eyes.dispose();
        this.eyeMaterial?.dispose();
        this.eyeMaterial = null;
    }

    // A recording now coming out of this person's mouth (Sound.shot's account of it), of `kind`, to be mouthed.
    speak(playing, now: () => number, kind = '') {
        this.voice = playing;
        this.now = now;
        this.kind = kind;
    }

    // How loud the voice is at this moment, 0 to 1, from the recording itself.
    _loudness() {
        const v = this.voice;
        if (!v) return 0;
        const t = this.now() - v.start;
        if (t < 0 || t > v.length / v.rate) { this.voice = t < 0 ? v : null; if (!this.voice) this.kind = ''; return 0; }
        const data = v.buffer.getChannelData(0), sr = v.buffer.sampleRate;
        const at = Math.floor((v.from + t * v.rate) * sr), n = Math.floor(WINDOW * sr);
        let sum = 0;
        for (let i = Math.max(0, at - n); i < Math.min(data.length, at); i++) sum += data[i] * data[i];
        return Math.min(1, Math.sqrt(sum / n) * 4.5);
    }

    // `v` is the person's vitals. Called after the body's pose and physics have put the head where it is.
    // `hangs` is how far (degrees) a broken or dislocated jaw hangs open whatever the face would do.
    update(dt, v, crying: boolean, hangs = 0) {
        if (!this.bones.length || dt <= 0) return;
        this.clock += dt;
        const s = this.state, npc = this.npc;
        const dead = v.dead, conscious = dead ? 0 : v.conscious;
        // How much of a face is left to make expressions with: all of it awake, none out cold.
        const alert = ramp(conscious, 0.35, 0.85);
        const loud = this._loudness(), kind = this.voice ? this.kind : '';

        // --- pain: a lasting ache and the flare of a fresh hurt
        const hurt = Math.max(0, v.pain - s.lastPain);
        s.lastPain = v.pain;
        s.flare = Math.min(1, s.flare * Math.exp(-dt / 2.5) + hurt * 2.5);
        s.pain = clamp(Math.pow(v.pain, 0.8) * 0.65 + s.flare) * alert;
        // (a fresh hurt draws the eyes to it at once)
        if (hurt > 0.08) this.gaze.next = 0;

        // --- fear: a weapon pointed at them, a shot or a blast, a fresh hurt, blood running out
        const w = npc.world, flash = w.weapons?.flashAt ?? 0;
        if (flash !== s.flash) { if (alert > 0.2) s.startle = 1; s.flash = flash; }
        s.startle = Math.max(0, s.startle - dt / 0.6);
        const threat = this._threat(), anxious = ramp(v.lost, 0.12, 0.35) * 0.5;
        const fear = Math.max(threat, s.flare * 0.6, anxious, s.startle * 0.8) * alert;
        s.fear += (fear - s.fear) * Math.min(1, dt / (fear > s.fear ? 0.25 : 4));

        // --- slack: the brain short of blood or oxygen, or nobody there
        s.slack = dead ? 1 : 1 - alert;
        s.deadFor = dead ? s.deadFor + dt : 0;

        // --- the action units
        const target: Record<string, number> = Object.fromEntries(ALL.map((k) => [k, 0]));
        const take = (face: Record<string, number>, k = 1) => { for (const [u, x] of Object.entries(face)) if (u in target) target[u] = Math.max(target[u], x * k); };
        take(PAIN(s.pain, s.flare));
        take(FEAR(s.fear));
        if (s.startle > 0) take({ AU1: 0.6, AU2: 0.6, AU4: 0.3, AU5: 0.8, AU20: 0.8, AU43: s.startle > 0.85 ? 1 : 0 }, s.startle);
        if (crying && alert > 0.2) take(CRIES.cry.face, 0.85 * alert);
        if (kind && CRIES[kind]) take(CRIES[kind].face, Math.min(1, 0.55 + loud) * Math.max(alert, kind === 'dying' ? 1 : 0));
        // (onset quick, release slower: a face falls back to rest over half a second or so)
        for (const u of ALL) this.au[u] += (target[u] - this.au[u]) * Math.min(1, dt * (target[u] > this.au[u] ? 9 : 2.5));
        const au = this.au;

        // --- the jaw: the voice, breathing through the mouth, slack, a broken jaw hanging
        s.breath += dt * Math.max(v.rr, 0) / 60;
        const hunger = v.breathing && !dead ? Math.max(ramp(v.rr, 22, 34), ramp(98 - v.spo2, 6, 20), ramp(1 - v.airway, 0.2, 0.6)) : 0;
        const inhale = Math.max(0, Math.sin(s.breath * Math.PI * 2));
        const sag = this._sag();
        let jaw = Math.max(loud * (CRIES[kind]?.jaw ?? 26) * Math.max(alert, 0.6), hunger * (4 + 10 * inhale) * (0.4 + 0.6 * conscious), FEAR(s.fear).AU26 * 12,
            au.AU27 * 18, s.pain * 2.5, hangs);
        // Slack, the jaw falls as far as gravity takes it; dead, further, and further as the minutes go (primary flaccidity).
        if (s.slack > 0) jaw = Math.max(jaw, s.slack * sag * (dead ? 14 + 8 * ramp(s.deadFor, 0, 120) : 10));
        this.jaw += (jaw - this.jaw) * Math.min(1, dt * (jaw > this.jaw ? 30 : dead ? 1.5 : 12));

        // --- blinks
        this._blinks(dt, v, alert, dead);
        this.eyes.update(dt);

        // --- the mix
        const wt = this.weights;
        wt.clear();
        const add = (unit: string, x: number) => { if (Math.abs(x) > 1e-3) for (const u of unit.includes('*') ? SIDES(unit) : [unit]) wt.set(u, (wt.get(u) ?? 0) + x); };
        for (const [k, unit, x] of MIX) add(unit, au[k] * x);
        // Weeping and a slack face turn the corners of the mouth down; a slack lower lip falls a little from the teeth.
        add('Mouth*PullDown', 0.25 * s.slack);
        add('lowerLipDown', 0.15 * s.slack);
        add('JawDrop', this.jaw / JAW_UNIT);
        // (the tongue lies flat on the floor of an open mouth, behind the lower teeth)
        add('TongueDown', ramp(this.jaw, 5, 30) * 0.5);
        this._lids(add, dead, alert);
        this._gaze(dt, add, v, alert, dead);
        this._compose();
        this.eyes.pose();

        // --- pupils and the colour of the skin
        const pupil = dead ? 5.5 : 3.4 + 1.6 * Math.max(s.fear, s.pain * 0.8) + 2.0 * ramp(92 - v.spo2, 0, 30) + 1.2 * ramp(v.lost, 0.2, 0.4);
        s.pupil += (pupil - s.pupil) * Math.min(1, dt / (pupil > s.pupil ? (dead ? 25 : 0.8) : 1.5));
        // (an eye whose sphincter a blow tore stays wide whatever the other does: traumatic mydriasis)
        if (this.pupil) for (const k of [0, 1] as const) { const e = this.eyes.which(k); this.pupil.sizes[k] = (e.pupil || s.pupil) / MM_IRIS; }
        // Pale with blood lost and the pressure falling (the skin's vessels shut down first), paler still once dead.
        const pale = dead ? 1 : Math.max(ramp(v.lost, 0.12, 0.4), ramp(70 - v.map, 0, 40)) * 0.85;
        s.pale += (pale - s.pale) * Math.min(1, dt / (dead ? 60 : 8));
        this._pallor(s.pale);
    }

    // How far gravity takes a slack jaw open: the most with the face up or the head upright, none face down.
    _sag() {
        const head = this.npc.ragdoll?.byName.get('head')?.node;
        if (!head) return 1;
        const up = head.getDirection(V3.Up()), fwd = head.getDirection(V3.Forward());
        return clamp(0.25 + Math.max(0, up.y) * 0.6 + Math.max(0, fwd.y) * 0.9 - Math.max(0, -fwd.y) * 0.8);
    }

    // How threatening the player is to this person, 0 to 1: holding a weapon, near, and pointing it at them.
    _threat() {
        const w = this.npc.world, arm = w.weapons?.arm, cam = w.camera;
        if (!arm || !cam || !/gun|blade|blunt|grenade/.test(arm.kind)) return 0;
        const head = this.npc.ragdoll?.byName.get('head')?.node.position;
        if (!head) return 0;
        const to = head.subtract(cam.position), d = to.length();
        const aimed = V3.Dot(to.scaleInPlace(1 / Math.max(d, 1e-3)), cam.getDirection(V3.Forward()));
        const reach = arm.kind === 'gun' ? 12 : 3;
        return ramp(aimed, arm.kind === 'gun' ? 0.94 : 0.7, 0.995) * ramp(reach - d, 0, reach * 0.6) + ramp(2 - d, 0, 1.5) * 0.4;
    }

    // Blinking: a blink every few seconds (more often frightened or hurting, slower and longer as the brain goes), each
    // closing fast and opening slower. None out cold or dead. A startle blinks at once.
    _blinks(dt, v, alert, dead) {
        const s = this.state;
        if (dead || alert <= 0.05) { s.blinkT = -1; this.blink = 0; return; }
        if (s.startle > 0.95 && s.blinkT < 0) s.blinkT = 0;
        if (s.blinkT < 0 && (s.nextBlink -= dt * (1 + 1.3 * s.fear + 0.8 * s.pain) * (0.6 + 0.4 * alert)) <= 0) {
            s.blinkT = 0;
            s.blinkLong = 1 + 2 * (1 - alert);
            // (intervals from 1 to 10 s about a mean of 3.5 s; one in eight comes straight after the last: a double blink)
            s.nextBlink = Math.random() < 0.12 ? 0.25 : Math.min(10, Math.max(1, -Math.log(1 - Math.random()) * 2.6 + 0.9));
        }
        if (s.blinkT >= 0) {
            s.blinkT += dt / s.blinkLong;
            const t = s.blinkT;
            this.blink = t < 0.08 ? t / 0.08 : t < 0.11 ? 1 : Math.max(0, 1 - (t - 0.11) / 0.17);
            if (t > 0.28) { s.blinkT = -1; this.blink = 0; }
        }
    }

    // The lids: what the face asks of them (raised in fear, tightened in pain, shut at pain's worst), a blink over that,
    // heavy as the brain goes, nearly shut out cold, part open dead, and shut as far as the swelling has closed them.
    _lids(add, dead: boolean, alert: number) {
        const au = this.au, s = this.state;
        const heavy = dead ? s.deadLids : alert <= 0.05 ? 0.85 + 0.1 * wander(this.clock * 0.2, this.seed) : (1 - alert) * 0.5;
        for (const side of ['Left', 'Right'] as const) {
            const swollen = this.swollen[side[0]];
            // (and clamped shut over an eye that is hurt: eyes.ts)
            const shut = Math.min(1.05, Math.max(this.blink * 1.05, au.AU43, au.AU7 * 0.25, heavy, swollen, dead ? 0 : this.eyes.shut(side[0] as 'L' | 'R', alert)));
            add(`${side}UpperLidClosed`, shut);
            add(`${side}UpperLidOpen`, Math.max(0, au.AU5 * 0.9 - shut));
            add(`${side}LowerLidUp`, Math.min(1, au.AU7 * 0.6 + au.AU6 * 0.4 + this.blink * 0.25 + au.AU43 * 0.3 + swollen * 0.45));
        }
    }

    // Where the eyes point. Awake, at something (_target), both eyes turned on the same point and held on it however the
    // head moves, a saccade to each new one; dazed, unfocused and drifting; out cold, roving slowly and turned up; dead,
    // still, drifted out to rest.
    _gaze(dt, add, v, alert: number, dead: boolean) {
        const g = this.gaze;
        let want: { L: number[]; R: number[] };
        if (dead) want = { L: [4, -3], R: [-4, -3] };
        else if (alert <= 0.05 || (this.eyes.blind('L') && this.eyes.blind('R'))) {
            // Out cold, or nothing left to see with: no fixing on anything, the eyes roving together (awake, level).
            const rove = 12 * wander(this.clock * 0.6, this.seed), up = alert <= 0.05 ? 14 : 4 * wander(this.clock * 0.4, this.seed + 3);
            want = { L: [rove + 2, up], R: [rove - 2, up] };
        } else {
            g.t += dt;
            if ((g.next -= dt) <= 0) this._choose(v, alert);
            const at = this._spot();
            want = at ? this._aim(at) : { L: [0, 0], R: [0, 0] };
            // Unfocused as the brain goes: the eyes drift toward straight ahead and apart, slowly.
            const lost = 1 - alert;
            for (const [k, sgn] of [['L', 1], ['R', -1]] as const) {
                want[k][0] = want[k][0] * (1 - lost) + lost * (2 * sgn + 8 * wander(this.clock * 0.3, this.seed));
                want[k][1] = want[k][1] * (1 - lost) + lost * (-4 + 4 * wander(this.clock * 0.23, this.seed + 1));
            }
            // Microsaccades: tiny jumps of a fraction of a degree, one or two a second, while fixing on something.
            if ((g.microAt -= dt) <= 0) { g.microAt = 0.4 + Math.random() * 0.9; g.micro = [(Math.random() - 0.5) * 0.8, (Math.random() - 0.5) * 0.6]; }
            // A blind eye fixes on nothing: it is carried with the seeing one (both get the same command, Hering's law).
            if (this.eyes.blind('L')) want.L = [...want.R];
            else if (this.eyes.blind('R')) want.R = [...want.L];
        }
        for (const k of ['L', 'R'] as const) {
            const to = want[k], cur = g[k];
            if (!dead && alert > 0.05 && g.t < g.length) {
                // A saccade: from where it began to where the target is now, fast in the middle (the main sequence).
                const x = ramp(g.t / g.length, 0, 1);
                cur[0] = g.from[k][0] + (to[0] - g.from[k][0]) * x;
                cur[1] = g.from[k][1] + (to[1] - g.from[k][1]) * x;
            } else {
                // Held on the point (the reflexes keep a fixed point fixed as the head moves); slow drifts are followed.
                const k2 = Math.min(1, dt * (dead ? 0.5 : alert <= 0.05 ? 3 : 25));
                cur[0] += (to[0] + (dead ? 0 : g.micro[0]) - cur[0]) * k2;
                cur[1] += (to[1] + (dead ? 0 : g.micro[1]) - cur[1]) * k2;
            }
            const side = k === 'L' ? 'Left' : 'Right';
            // Yaw positive to the person's left; pitch positive up. Eyes go about 40 degrees across and 30 up, 40 down.
            const yaw = clamp(cur[0], -38, 38), pitch = clamp(cur[1], -35, 28);
            add(`${side}${yaw > 0 ? 'EyeturnLeft' : 'EyeturnRight'}`, Math.abs(yaw) / this.eyeUnits[`${side}${yaw > 0 ? 'EyeturnLeft' : 'EyeturnRight'}`]);
            add(`${side}${pitch > 0 ? 'EyeUp' : 'EyeDown'}`, Math.abs(pitch) / this.eyeUnits[`${side}${pitch > 0 ? 'EyeUp' : 'EyeDown'}`]);
        }
    }

    // What to look at next, and for how long: mostly the player's face (the one in front of them, and the danger), a
    // fresh wound for a moment after a hurt, now and then somewhere else. Frightened, short looks that keep coming back to
    // the threat (vigilant scanning); hurting, back to the wound.
    _choose(v, alert: number) {
        const g = this.gaze, s = this.state, wound = this.npc.behaviour?.wound;
        const r = Math.random();
        const fresh = wound && wound.t < 6 && v.pain > 0.1;
        let target = 'player';
        if (fresh && (wound.t < 1.2 || r < 0.3 + 0.3 * s.pain)) target = 'wound';
        else if (s.fear > 0.4) target = r < 0.75 ? 'player' : 'away';
        else target = r < 0.6 ? 'player' : r < 0.75 ? 'body' : r < 0.9 ? 'away' : 'down';
        const was = this._spot();
        g.target = target;
        g.spot = null;
        if (target === 'away' || target === 'down' || target === 'body') g.spot = this._place(target);
        const now = this._spot();
        g.next = (s.fear > 0.4 ? 0.3 + Math.random() * 0.8 : target === 'player' ? 1.2 + Math.random() * 2.8 : 0.5 + Math.random() * 1.2) / (0.5 + 0.5 * alert);
        // A saccade to it: its size, and its length by the main sequence.
        if (was && now) {
            const a = this._aim(was), b = this._aim(now);
            const size = Math.hypot(a.L[0] - b.L[0], a.L[1] - b.L[1]);
            g.from = { L: [...this.gaze.L], R: [...this.gaze.R] };
            g.t = 0;
            g.length = (21 + 2.2 * size) / 1000;
        }
    }

    // A place to glance at: the player's body, aside, at the floor ahead (in the world, chosen once per look).
    _place(target: string) {
        const head = this.npc.ragdoll?.byName.get('head')?.node, cam = this.npc.world.camera;
        if (!head || !cam) return null;
        if (target === 'body') return cam.position.add(new V3((Math.random() - 0.5) * 0.3, -0.35 - Math.random() * 0.5, 0));
        const fwd = head.getDirection(V3.Forward()), side = head.getDirection(V3.Right());
        if (target === 'down') return head.position.add(fwd.scale(1.2)).addInPlace(new V3(0, -1.4, 0)).addInPlace(side.scale((Math.random() - 0.5) * 0.8));
        return head.position.add(fwd.scale(2.5)).addInPlace(side.scale((Math.random() < 0.5 ? -1 : 1) * (0.6 + Math.random() * 0.9))).addInPlace(new V3(0, (Math.random() - 0.5) * 0.6, 0));
    }

    // Where the eyes' current target is in the world, or null.
    _spot(): BABYLON.Vector3 | null {
        const g = this.gaze, npc = this.npc;
        if (g.target === 'player') return npc.world.camera?.position ?? null;
        if (g.target === 'wound') {
            const w = npc.behaviour?.wound;
            return w ? V3.TransformCoordinates(w.local, w.seg.node.getWorldMatrix()) : null;
        }
        return g.spot;
    }

    // Each eye's yaw (positive to the person's left) and pitch (positive up), degrees, to look at world point `at`.
    _aim(at: BABYLON.Vector3) {
        const p = this.person, r = this.eyeRest;
        // The head bone's place, its own chain up to the root (the whole skeleton's would be ten times the work).
        _m.copyFrom(p.byName.head.bone.getLocalMatrix());
        for (let b = p.byName.head.bone.getParent(); b; b = b.getParent()) _m.multiplyToRef(b.getLocalMatrix(), _m);
        _m.multiplyToRef(p.mesh.getWorldMatrix(), _m);
        _m.invertToRef(_inv);
        V3.TransformCoordinatesToRef(at, _inv, _v);
        const out = { L: [0, 0], R: [0, 0] };
        for (const k of ['L', 'R'] as const) {
            // (the head bone's frame is the rest frame turned with it, its origin at the head's own joint)
            const x = _v.x - (r[k].x - r.head.x), y = _v.y - (r[k].y - r.head.y), z = _v.z - (r[k].z - r.head.z);
            out[k] = [Math.atan2(-x, z) / RAD, Math.atan2(y, Math.hypot(x, z)) / RAD];
        }
        return out;
    }

    // The units' weights into the bones: each bone turned by every unit that turns it, each unit's turn scaled by its
    // weight (MakeHuman's blend, PoseUnit.getBlendedPose: later units on the left).
    _compose() {
        const qs = this.quats;
        for (let i = 0; i < qs.length; i += 4) { qs[i] = qs[i + 1] = qs[i + 2] = 0; qs[i + 3] = 1; }
        for (const [name, w] of this.weights) {
            const parts = this.units.get(name);
            if (!parts) continue;
            for (const part of parts) {
                const half = part.angle * w / 2, sn = Math.sin(half), o = part.slot * 4;
                _d.set(part.axis.x * sn, part.axis.y * sn, part.axis.z * sn, Math.cos(half));
                _q.set(qs[o], qs[o + 1], qs[o + 2], qs[o + 3]);
                _d.multiplyToRef(_q, _q);
                qs[o] = _q.x; qs[o + 1] = _q.y; qs[o + 2] = _q.z; qs[o + 3] = _q.w;
            }
        }
        this.bones.forEach((bone, k) => { _q.set(qs[k * 4], qs[k * 4 + 1], qs[k * 4 + 2], qs[k * 4 + 3]); bone.setRotationQuaternion(_q, BABYLON.Space.LOCAL); });
    }

    // The skin's colour as the blood leaves it: the red goes first, toward a grey-yellow white (pallor).
    _pallor(pale: number) {
        const mats = this.npc.skinMaterials as BABYLON.PBRMaterial[] | undefined;
        if (!mats?.length) return;
        const r = 1 - 0.16 * pale, g = 1 - 0.07 * pale, b = 1 - 0.05 * pale;
        if (Math.abs(mats[0].albedoColor.r - r) < 0.002) return;
        for (const m of mats) m.albedoColor.set(r, g, b);
    }
}

// The iris in MakeHuman's eye textures (both eyes are painted on one sheet): the two centres in UV, the iris's and the
// painted pupil's radius, measured from the pictures (tools: the dark disc's area and the brightness out from it).
const IRISES = {
    brown: { centres: [0.7041, 0.7019, 0.2884, 0.29], iris: 0.105, pupil: 0.0374 },
    bluegreen: { centres: [0.7059, 0.7047, 0.2929, 0.299], iris: 0.105, pupil: 0.0296 },
};

// The pupil drawn at any size: inside the iris, the picture is sampled from where the painted pupil and iris would put
// that point, so the pupil grows into the iris and the iris's pattern is squeezed toward its rim, as a real iris's is.
export class PupilLayer extends BABYLON.MaterialPluginBase {
    // Each pupil's share of its iris: the one round the table's first centre, then the second's.
    declare sizes: [number, number];
    declare iris: { centres: number[]; iris: number; pupil: number };

    constructor(material: BABYLON.Material, iris) {
        super(material, 'Pupil', 210, { PUPIL: false });
        this.iris = iris;
        this.sizes = [0.3, 0.3];
        this._enable(true);
    }

    getClassName() { return 'PupilLayer'; }

    prepareDefines(defines) { defines.PUPIL = true; }

    getUniforms() { return { ubo: [{ name: 'pupilCentres', size: 4, type: 'vec4' }, { name: 'pupilSizes', size: 4, type: 'vec4' }] }; }

    bindForSubMesh(ubo) {
        const c = this.iris.centres, shown = (x: number) => Math.min(0.85, Math.max(0.12, x)) * this.iris.iris;
        ubo.updateFloat4('pupilCentres', c[0], c[1], c[2], c[3]);
        ubo.updateFloat4('pupilSizes', this.iris.iris, this.iris.pupil, shown(this.sizes[0]), shown(this.sizes[1]));
    }

    getCustomCode(shaderType) {
        if (shaderType !== 'fragment') return null;
        return {
            CUSTOM_FRAGMENT_DEFINITIONS: `#ifdef PUPIL
vec2 pupilUV(vec2 uv) {
    bool first = distance(uv, pupilCentres.xy) < distance(uv, pupilCentres.zw);
    vec2 c = first ? pupilCentres.xy : pupilCentres.zw;
    vec2 d = uv - c;
    float r = length(d), R = pupilSizes.x, painted = pupilSizes.y, shown = first ? pupilSizes.z : pupilSizes.w;
    if (r >= R || r < 1e-6) return uv;
    float from = r < shown ? r * painted / shown : painted + (r - shown) * (R - painted) / (R - shown);
    return c + d * (from / r);
}
#endif
`,
            '!(vec4 albedoTexture=TEXRD\\(albedoSampler,)(vAlbedoUV\\+uvOffset)(\\);)': `#ifdef PUPIL
$1pupilUV($2)$3
#else
$1$2$3
#endif
`,
        };
    }
}
