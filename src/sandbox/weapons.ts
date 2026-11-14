// What is in the player's hands, and what it does.
//
// The guns fire real loads, measured: a 9 mm round leaves at 360 m/s with
// about 480 J, a 7.62 rifle round at 820 m/s with 2.7 kJ, a 12 bore shell
// throws nine 00 buckshot pellets of 3.5 g each. What happens to a body is
// wounds.ts's business; here a shot is a line that is followed through
// people and on until it is spent or meets a wall. Blades are a stab (a short
// line from the eye) or a cut (a fan of short lines swept across), and a bat
// is a swing that lands a blow on the first person it meets.

import * as BABYLON from '@babylonjs/core';
import { place } from '../glb.ts';
import { pierce, blow, type Missile } from './wounds.ts';
import { rayToSegment } from './anatomy.ts';
import { blast } from './dismember.ts';
import * as viscera from './viscera.ts';
import { Fist } from './fist.ts';
import { Hands, type Grip } from './hands.ts';
import { Medic, buildKit } from './dressing.ts';
import { GAMMA, RHO, volume } from './fluid.ts';
import { Muzzle } from './muzzle.ts';
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion;
const FRAGMENTS = 1000;      // an M67's body breaks into roughly this many that can wound

// Blood a blade brings out of a wound (dev/research/stab-wounds.md sec. 2). Nobody has measured it. Pulled out of a pool
// at 1 m/s a plate keeps a film 0.34 mm thick (Landau-Levich), but the skin's edges wipe the blade on its way out: taken
// as 0.03 mm over both faces of what went in, of which 0.01 mm stays on as a smear that nothing shakes off (estimates).
const FILM = 0.00003, SMEAR = 0.00001;
const DRIES = 300;          // seconds for blood on the blade to go from wet red to dull brown (a thin film: an estimate)

type Gun = Missile & { rounds: number; every: number; pellets: number; spread: number; kick: number; sound: string; reload: number; speed: number; auto?: boolean;
    skips?: number };
// The handguns' slides, and how far each runs back (m): a 9 mm service pistol's about 24 mm, the Desert Eagle's about 32.
const SLIDE: Record<string, number> = { pistol: 0.024, deagle: 0.032 };

// How each thing is held, in the eye's own frame (x right, y up, z ahead). `at` is where its grip is at rest: low and to
// the right, a long gun's stock back in the shoulder. A blade or the bat is turned `turn` (x pitch, y yaw, z roll); a
// gun has its bore laid on the line to the point AIMED metres ahead of the eye (the shots go from the eye, so the muzzle
// points where they land). `right` and `left` are where each hand goes on it, in its own frame (hands.ts Grip; a hand not
// given hangs out of sight). `kick`: how far a shot drives a gun back into the hands (m) and turns it up about its grip
// (rad): a pistol, held out at arm's length, flips most; a rifle's stock in the shoulder takes it.
// (The grip of each model is weapons.json's; z runs along its bore or blade, y toward its top or back.)
const AIMED = 15;
// A long gun's firing hand: on a pistol grip raked back some 20 degrees, the index finger along to the trigger.
// Its other hand reaches the forend because the body turns that shoulder forward and in, as a rifleman stands.
const FORWARD = [-0.06, 0, 0.12];
const PISTOL_GRIP: Grip = { hold: 'grip', at: [0, -0.005, -0.005], along: [0, -0.94, -0.34], back: [0, -0.34, 0.94] };
export const HELD: Record<string, { at: number[]; turn?: number[]; right?: Grip; left?: Grip; kick?: number[] }> = {
    knife: { at: [0.17, -0.17, 0.42], turn: [-0.75, -0.2, -0.1],
        right: { hold: 'handle', at: [0, 0, 0], along: [0, 0, -1], back: [0, -1, 0] } },
    sword: { at: [0.16, -0.21, 0.45], turn: [-0.95, -0.3, 0.15],
        right: { hold: 'handle', at: [0, 0, 0], along: [0, 0, -1], back: [0, -1, 0] },
        left: { hold: 'handle', at: [0, 0, -0.1], along: [0, 0, -1], back: [0, -1, 0] } },
    bat: { at: [0.19, -0.22, 0.42], turn: [-1.15, -0.35, 0.3],
        right: { hold: 'handle', at: [0, 0, 0.085], along: [0, 0, -1], back: [0, -1, 0] },
        left: { hold: 'handle', at: [0, 0, 0], along: [0, 0, -1], back: [0, -1, 0] } },
    pistol: { at: [0.07, -0.115, 0.5], kick: [0.035, 0.2],
        right: { hold: 'grip', at: [0, -0.005, -0.005], along: [0, -0.95, -0.31], back: [0, -0.31, 0.95] },
        left: { hold: 'support', at: [-0.022, -0.02, 0.008], along: [0.1, -0.95, -0.3], back: [0.45, -0.25, 0.85] } },
    rifle: { at: [0.15, -0.165, 0.32], kick: [0.06, 0.12],
        right: { hold: 'grip', at: [0, 0, 0], along: [0, -0.77, -0.64], back: [0, -0.64, 0.77] },
        left: { hold: 'wrap', at: [0, 0.01, 0.36], along: [-0.15, -0.2, -0.97], back: [0.85, 0.5, 0], shoulder: FORWARD } },
    shotgun: { at: [0.15, -0.17, 0.34], kick: [0.06, 0.15],
        right: { hold: 'grip', at: [0, 0, 0], along: [0, -0.77, -0.64], back: [0, -0.64, 0.77] },
        left: { hold: 'wrap', at: [0, 0.04, 0.32], along: [-0.15, -0.2, -0.97], back: [0.85, 0.5, 0], shoulder: FORWARD } },
    ak: { at: [0.15, -0.175, 0.36], kick: [0.03, 0.06], right: PISTOL_GRIP,
        left: { hold: 'wrap', at: [0, 0.075, 0.29], along: [-0.15, -0.2, -0.97], back: [0.85, 0.5, 0], shoulder: FORWARD } },
    m4: { at: [0.15, -0.165, 0.34], kick: [0.025, 0.05], right: PISTOL_GRIP,
        left: { hold: 'wrap', at: [0, 0.07, 0.27], along: [-0.15, -0.2, -0.97], back: [0.85, 0.5, 0], shoulder: FORWARD } },
    grenade: { at: [0.15, -0.16, 0.4], turn: [-1.3, -0.2, 0],
        right: { hold: 'ball', at: [0, 0, -0.005], along: [0, 0, -1], back: [-1, 0, 0] } },
    bandage: { at: [0.1, -0.13, 0.4], turn: [0.3, 0, 0],
        right: { hold: 'ball', at: [0, 0, 0], along: [-1, 0, 0], back: [0, 1, 0] },
        left: { hold: 'pinch', at: [-0.03, -0.065, -0.025], along: [0, 1, 0], back: [1, 0, 0] } },
    // A .50 AE Desert Eagle weighs 2 kg and has about four times a 9 mm service pistol's free recoil (some 25 J against 6):
    // it drives back and flips up far more, held out the same way in two hands.
    // (Its grip is raked back further than the 9 mm's, about 37 degrees: the hands lie along it.)
    deagle: { at: [0.06, -0.11, 0.52], kick: [0.06, 0.45],
        right: { hold: 'grip', at: [0, 0, 0], along: [0, -0.8, -0.6], back: [0, -0.6, 0.8] },
        left: { hold: 'support', at: [-0.026, -0.018, 0.01], along: [0.1, -0.8, -0.59], back: [0.45, -0.35, 0.82] } },
    // A 10/22: a straight wrist (no pistol grip), the other hand under the forend. Its .22 LR recoils by a fraction of a
    // joule in a 2.3 kg rifle: hardly a nudge.
    r22: { at: [0.15, -0.165, 0.33], kick: [0.006, 0.012],
        right: { hold: 'grip', at: [0, 0, 0], along: [0, -0.77, -0.64], back: [0, -0.64, 0.77] },
        left: { hold: 'wrap', at: [0, -0.02, 0.36], along: [-0.15, -0.2, -0.97], back: [0.85, 0.5, 0], shoulder: FORWARD } },
    // The tools in both hands (the hammer in one), carried up as the bat is.
    shovel: { at: [0.19, -0.22, 0.42], turn: [-1.0, -0.35, 0.3],
        right: { hold: 'handle', at: [0, 0, 0], along: [0, 0, -1], back: [0, -1, 0] },
        left: { hold: 'handle', at: [0, 0, 0.32], along: [0, 0, -1], back: [0, -1, 0] } },
    sledge: { at: [0.2, -0.26, 0.4], turn: [-1.0, -0.35, 0.3],
        right: { hold: 'handle', at: [0, 0, 0.12], along: [0, 0, -1], back: [0, -1, 0] },
        left: { hold: 'handle', at: [0, 0, 0], along: [0, 0, -1], back: [0, -1, 0] } },
    hammer: { at: [0.17, -0.19, 0.42], turn: [-1.05, -0.2, -0.1],
        right: { hold: 'handle', at: [0, 0, 0], along: [0, 0, -1], back: [0, -1, 0] } },
    medkit: { at: [0, -0.2, 0.5], turn: [0.35, 0.1, 0],
        right: { hold: 'wrap', at: [0.12, 0, 0], along: [0, -1, 0], back: [0, 0, 1] },
        left: { hold: 'wrap', at: [-0.12, 0, 0], along: [0, -1, 0], back: [0, 0, 1] } },
};

// Swings, as poses along the way (fraction of the swing, then `at` and `turn` as in HELD), from and back to rest. A stab
// is driven home by 0.09 s (when _swing's stab lands: a quarter of the way) and held there until it comes out at three
// quarters; a cut or a blow comes in from the right and sweeps across to the left over the middle of its time, as the
// lines that find what it meets do (_sweep), the edge leading.
const DOWN = [[0.3, 0.1, 0.12, 0.2, -2.1, -0.15, 0.1], [0.5, 0.04, -0.12, 0.5, 0.35, -0.05, 0.05], [0.72, 0.04, -0.16, 0.48, 0.45, -0.05, 0.05]];
export const SWINGS: Record<string, Record<string, number[][]>> = {
    knife: {
        stab: [[0.08, 0.21, -0.21, 0.33, -0.3, -0.15, -0.1], [0.26, 0.06, -0.1, 0.6, -0.08, -0.1, -0.1], [0.72, 0.06, -0.1, 0.62, -0.08, -0.1, -0.1]],
        cut: [[0.18, 0.3, -0.1, 0.3, -0.2, 1, -0.9], [0.47, 0.06, -0.14, 0.5, -0.05, 0, -1.4], [0.75, -0.22, -0.2, 0.34, 0.05, -1.05, -1.5]],
    },
    sword: {
        stab: [[0.08, 0.17, -0.28, 0.34, -0.5, -0.2, 0], [0.26, 0.07, -0.16, 0.52, -0.06, -0.1, 0], [0.72, 0.07, -0.16, 0.54, -0.06, -0.1, 0]],
        cut: [[0.2, 0.3, -0.06, 0.26, -0.6, 1, -0.8], [0.47, 0.06, -0.16, 0.44, -0.05, 0, -1.4], [0.75, -0.24, -0.22, 0.3, 0.1, -1, -1.5]],
    },
    bat: {
        blow: [[0.2, 0.32, -0.12, 0.16, -1.5, 0.5, 0.9], [0.47, 0.06, -0.18, 0.4, -0.15, 0, -1.4], [0.75, -0.24, -0.22, 0.3, 0.1, -1.1, -1.5]],
    },
    // The tools also come down from overhead (`down`): raised up and back, brought down onto what is ahead, landing at
    // half way (_sweep), and held there a moment.
    shovel: {
        blow: [[0.2, 0.32, -0.1, 0.18, -1.2, 0.6, 0.6], [0.47, 0.06, -0.16, 0.42, -0.1, 0, -1.4], [0.75, -0.24, -0.2, 0.3, 0.1, -1.1, -1.5]],
        down: DOWN,
    },
    sledge: {
        blow: [[0.22, 0.32, -0.08, 0.14, -1.6, 0.5, 0.9], [0.47, 0.06, -0.18, 0.4, -0.15, 0, -1.4], [0.75, -0.24, -0.24, 0.3, 0.1, -1.1, -1.5]],
        down: DOWN,
    },
    hammer: {
        blow: [[0.2, 0.3, -0.1, 0.2, -1.6, 0.5, 0.6], [0.47, 0.05, -0.15, 0.45, -0.15, 0, -1.4], [0.75, -0.2, -0.2, 0.32, 0.1, -1.0, -1.5]],
        down: DOWN,
    },
};

// Parts of a model that move in the hands, by their glTF node names: a pistol's slide and magazine, the M4's magazine
// and charging handle, the bolt rifle's bolt, the grenade's pin.
const PARTS: Record<string, Record<string, RegExp>> = { pistol: { slide: /slide/, mag: /magazine/ }, m4: { mag: /^Magazine$/, handle: /^Charging_Handle$/ }, rifle: { bolt: /bolt_[ab]$/ },
    grenade: { pin: /^pin$/ }, ak: { mag: /^mag$/ }, shotgun: { barrels: /^barrels$/ },
    deagle: { slide: /^(Slide|Bolt|Ironsights Back|Safety|Safety Screw)$/, mag: /^(Magazine|Bullets)$/ }, r22: { mag: /^mag$/, handle: /^handle$/ } };
// Parts that two models have only as loose pieces of one mesh, picked out by their bounds in the model's own (glTF)
// frame: the AK's magazine (the one piece that hangs 10 cm below the bore line) and the shotgun's barrels with their
// forend (everything ahead of the hinge), which break open.
const SPLIT: Record<string, Record<string, (lo: BABYLON.Vector3, hi: BABYLON.Vector3) => boolean>> = {
    ak: { mag: (lo) => lo.y < -0.1 }, shotgun: { barrels: (lo) => lo.z > 0.06 } };
type Part = { nodes: { node: BABYLON.TransformNode; at: BABYLON.Vector3; turn: BABYLON.Quaternion; size: BABYLON.Vector3; local: BABYLON.Matrix }[]; min: BABYLON.Vector3; max: BABYLON.Vector3 };

export const ARMS = [
    { key: 'knife', name: 'Knife', kind: 'blade', reach: 1.0, swing: 0.32,
        stab: { energy: 70, mass: 0.2, calibre: 0.02, channel: 0.006, soft: 1.4, hard: 40, reach: 0.17, blade: true, edges: 1, taper: 0.04 } as Missile, cut: 0.022 },
    { key: 'sword', name: 'Sword', kind: 'blade', reach: 1.65, swing: 0.5,
        stab: { energy: 150, mass: 1.2, calibre: 0.03, channel: 0.01, soft: 1.2, hard: 40, reach: 0.75, blade: true, edges: 2, taper: 0.25 } as Missile, cut: 0.055 },
    { key: 'bat', name: 'Baseball bat', kind: 'blunt', reach: 1.25, swing: 0.55, mass: 0.79, speed: 15.5 },  // a man's full swing at head height: about 110 J (dev/research/blunt-trauma.md)
    { key: 'pistol', name: 'Pistol', kind: 'gun', gun: { energy: 480, mass: 0.008, speed: 360, calibre: 0.009, channel: 0.006, soft: 12, hard: 110, rounds: 15, every: 0.13,
        pellets: 1, spread: 0.004, kick: 0.035, sound: 'shot-pistol', reload: 1.6 } as Gun },
    { key: 'rifle', name: 'Rifle', kind: 'gun', gun: { energy: 2700, mass: 0.0097, speed: 820, calibre: 0.0078, channel: 0.012, soft: 28, hard: 160, rounds: 5, every: 1.1,
        pellets: 1, spread: 0.0012, kick: 0.07, sound: 'shot-rifle', reload: 2.6 } as Gun },
    { key: 'shotgun', name: 'Shotgun', kind: 'gun', gun: { energy: 170, mass: 0.0035, speed: 400, calibre: 0.0084, channel: 0.005, soft: 9, hard: 90, rounds: 2, every: 0.25,
        pellets: 9, spread: 0.028, kick: 0.12, sound: 'shot-shotgun', reload: 2.2 } as Gun },
    // 7.62x39: a 7.9 g bullet at 715 m/s, about 2 kJ, 600 a minute. It goes some way into a body before it yaws.
    { key: 'ak', name: 'AK-47', kind: 'gun', gun: { energy: 2020, mass: 0.0079, speed: 715, calibre: 0.0078, channel: 0.011, soft: 24, hard: 150, rounds: 30, every: 0.1,
        pellets: 1, spread: 0.0035, kick: 0.022, sound: 'shot-ak', reload: 2.5, auto: true } as Gun },
    // 5.56x45 M855 from a 14.5 inch barrel: 4 g at 900 m/s, about 1.6 kJ, 800 a minute. Fast enough to break up inside.
    { key: 'm4', name: 'M4A1', kind: 'gun', gun: { energy: 1620, mass: 0.004, speed: 900, calibre: 0.0057, channel: 0.013, soft: 22, hard: 130, rounds: 30, every: 0.075,
        pellets: 1, spread: 0.0025, kick: 0.016, sound: 'shot-m4', reload: 2.3, auto: true } as Gun },
    // .50 AE from the Desert Eagle's 6 inch barrel: a 300 grain (19.4 g) hollow point at about 1,450 ft/s (442 m/s), about
    // 1.9 kJ, seven in the magazine. A half-inch bullet that opens to near an inch: the widest handgun wound channel there
    // is, but a handgun's (no temporary cavity worth the name below 600 m/s, dev/research/wounds.md), and it goes some
    // 40 cm into soft tissue. Fired as fast as the recoil lets the sights come back down, about 0.3 s.
    { key: 'deagle', name: 'Desert Eagle .50', kind: 'gun', gun: { energy: 1900, mass: 0.0194, speed: 442, calibre: 0.0127, channel: 0.012, soft: 42, hard: 220,
        rounds: 7, every: 0.3, pellets: 1, spread: 0.004, kick: 0.09, sound: 'shot-deagle', reload: 2.0 } as Gun },
    // .22 LR from an 18.5 inch rifle barrel: a 40 grain (2.6 g) round-nose lead bullet at about 1,200 ft/s (366 m/s),
    // about 170 J; ten in the rotary magazine. 5.7 mm across, a small hole (dev/research/wounds.md: ~5 mm entries, taken
    // for ice-pick wounds), a narrow track, 30-40 cm of soft tissue; often stopped in the skull. Soft lead at a glancing
    // angle skips off concrete (`skips`, _shot).
    { key: 'r22', name: '.22 rifle (10/22)', kind: 'gun', gun: { energy: 170, mass: 0.0026, speed: 366, calibre: 0.0057, channel: 0.003, soft: 5, hard: 90,
        rounds: 10, every: 0.12, pellets: 1, spread: 0.0015, kick: 0.004, sound: 'shot-r22', reload: 2.4, skips: 0.26 } as Gun },
    // The tools. A man's full two-handed swing puts about 110 J into a bat (0.79 kg at 15.5 m/s, Guo26 in
    // dev/research/blunt-trauma.md sec. 9); taken as about the same work into anything he can swing as fast as his body
    // allows, a heavier head comes round slower: v = sqrt(2E/m). Brought down from overhead (`down`) it also falls, its
    // head dropping about 1.2 m (m g h more), and is swung harder.
    // Shovel: about 2 kg, some 1.5 kg of it at the blade end: 12 m/s, 110 J, the flat of the blade (a broad stiff face,
    // 'flat') or, from overhead, its edge ('edge': 2 cm2, the bone under it fractured and the skin split as a chop wound).
    { key: 'shovel', name: 'Shovel', kind: 'blunt', reach: 1.5, swing: 0.62, mass: 1.5, speed: 12, tool: 'flat',
        down: { tool: 'edge', speed: 13, cut: 0.02 }, sound: 'hit-shovel' },
    // Sledgehammer, a 10 lb (4.5 kg) head on a 90 cm handle: about 5 kg at the head with the handle's share, so 6.6 m/s
    // and 110 J swung level; from overhead 9 m/s, about 200 J (110 + 5 kg x 9.8 x 1.2 m = 170 J, and harder). Slow: a
    // swing takes most of a second. Its flat face crushes what it lands on: skull fracture takes 14-68 J (Yoganandan 1995).
    { key: 'sledge', name: 'Sledgehammer', kind: 'blunt', reach: 1.45, swing: 0.95, mass: 5, speed: 6.6, tool: 'flat',
        down: { speed: 9 }, sound: 'hit-sledge', whoosh: 'swing-heavy' },
    // Claw hammer, a 20 oz (0.57 kg) head: about 0.65 kg at 11 m/s in one hand, 39 J on a 1 inch face ('hammer'): the
    // round depressed skull fracture with a bone plug that hammer faces leave (Goots18, 9 of 12 impacts). Its claw, from
    // overhead, goes in 3-4 cm as two tines a couple of centimetres apart (a puncture, pierce).
    { key: 'hammer', name: 'Claw hammer', kind: 'blunt', reach: 0.95, swing: 0.4, mass: 0.65, speed: 11, tool: 'hammer',
        down: { claw: { energy: 39, mass: 0.65, calibre: 0.016, channel: 0.004, soft: 3, hard: 60, reach: 0.04, blade: true, edges: 2, taper: 0.03 } as Missile },
        sound: 'hit-hammer' },
    { key: 'grenade', name: 'M67 grenade', kind: 'grenade' },
    { key: 'hands', name: 'Hands', kind: 'grab' },
    { key: 'throw', name: 'Throw things', kind: 'throw' },
    // Held on a wound (dressing.ts): the bandage dresses the one looked at, the medkit every one the person has.
    { key: 'bandage', name: 'Bandage', kind: 'dress' },
    { key: 'medkit', name: 'Medkit', kind: 'dress' },
];

// What is heard of a reload and when, as a fraction of it (the strokes _reloading and _bolt show): the magazine out and
// seated, the slide or charging handle; the shotgun broken open, two shells in, closed; the bolt opened, five rounds
// thumbed in (where each press is deepest), the bolt closed.
const MAGAZINE = (charge: string): [number, string][] => [[0.13, 'mag-out'], [0.68, 'mag-in'], [0.77, charge]];
const RELOADS: Record<string, [number, string][]> = {
    pistol: MAGAZINE('rack'), deagle: MAGAZINE('rack'), ak: MAGAZINE('charge'), m4: MAGAZINE('charge'), r22: MAGAZINE('charge'),
    shotgun: [[0.13, 'break-open'], [0.55, 'shell-in'], [0.62, 'shell-in'], [0.78, 'break-close']],
    rifle: [[0.1, 'bolt-open'], ...[0, 1, 2, 3, 4].map((k): [number, string] => [0.34 + 0.38 * (k + 0.5) / 5, 'round-in']), [0.78, 'bolt-close']],
};

// Things to throw: the props from Poly Haven already in the game, and what each weighs.
// And how stiff each is where it lands, N/m (none: hard as the bone it hits); a cardboard box crumples.
const THROWN: [string, number, number?][] = [['metal_toolbox', 6], ['concrete_cat_statue', 4], ['dining_chair_02', 5], ['wooden_bucket_01', 2], ['cardboard_box_01', 0.6, 4000],
    ['vintage_electric_kettle', 1.2, 30000], ['metal_trash_can', 7, 60000]];

export class Weapons {
    declare world: any;
    declare current: number;
    declare hand: BABYLON.TransformNode;
    declare models: Map<string, BABYLON.TransformNode>;
    declare ammo: Map<string, number>;
    declare busy: number;
    declare action: any;
    declare recoil: number;
    declare flash: BABYLON.PointLight;
    declare flashCard: BABYLON.Mesh;     // the grenade's flash
    declare muzzle: Muzzle;
    declare holes: BABYLON.Mesh;
    declare holeCount: number;
    declare grab: any;
    declare thrown: any[];
    declare throwKind: number;
    declare casings: any[];
    declare reloading: number;
    declare firing: boolean;
    declare _anchors: Map<string, any>;
    declare slots: (string | null)[];
    declare bag: (string | null)[];
    declare slot: number;
    declare arsenal: any;
    declare grenades: any[];
    declare flashAt: number;
    declare fist: Fist | null;
    declare hands: Hands | null;
    declare parts: Map<string, Record<string, Part>>;
    declare clock: number;
    declare since: number;
    declare lag: { yaw: number; pitch: number; x: number; y: number };
    declare medic: Medic;
    declare blades: Map<string, { wet: number; held: number; age: number; at: BABYLON.Vector3 | null; v: BABYLON.Vector3 | null; looks: any[] }>;

    constructor(world) {
        this.world = world;
        // What is carried: six at hand (1 to 6), twelve more in the bag. An empty hand is the hands.
        this.slots = ['pistol', 'knife', null, null, null, null];
        this.bag = new Array(12).fill(null);
        this.slot = 0;
        this.current = 0;
        this.arsenal = null;
        this.grenades = [];
        this.fist = null;
        this.hands = null;
        this.parts = new Map();
        this.clock = 0;
        this.since = Infinity;
        this.lag = { yaw: 0, pitch: 0, x: 0, y: 0 };
        this.medic = new Medic(this);
        this.blades = new Map();
        const { scene, camera } = world;
        this.hand = new BABYLON.TransformNode('hand', scene);
        this.hand.parent = camera;
        this.models = new Map();
        this._anchors = new Map();
        this.ammo = new Map(ARMS.filter((a) => a.gun).map((a) => [a.key, a.gun.rounds]));
        this.busy = 0;
        this.action = null;
        this.recoil = 0;
        this.reloading = 0;
        this.firing = false;
        this.grab = null;
        this.thrown = [];
        this.throwKind = 0;
        this.casings = [];

        this.flash = new BABYLON.PointLight('muzzle', V3.Zero(), scene);
        this.flash.intensity = 0;
        this.flash.range = 8;
        this.flash.diffuse = new BABYLON.Color3(1, 0.75, 0.45);
        this.flashCard = BABYLON.MeshBuilder.CreatePlane('flash', { size: 0.16 }, scene);
        const fm = new BABYLON.StandardMaterial('flash', scene);
        fm.emissiveTexture = flashTexture(scene);
        fm.opacityTexture = fm.emissiveTexture;
        fm.disableLighting = true;
        fm.alphaMode = BABYLON.Engine.ALPHA_ADD;
        this.flashCard.material = fm;
        this.flashCard.isPickable = false;
        this.flashCard.setEnabled(false);
        this.flashCard.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;
        this.muzzle = new Muzzle(scene, this.hand);

        // Bullet holes in the room.
        this.holes = BABYLON.MeshBuilder.CreatePlane('holes', { size: 1 }, scene);
        const hm = new BABYLON.PBRMaterial('holes', scene);
        hm.albedoTexture = holeTexture(scene);
        hm.useAlphaFromAlbedoTexture = true;
        hm.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        hm.metallic = 0; hm.roughness = 0.9; hm.zOffset = -2;
        hm.useSpecularOverAlpha = false;
        hm.useRadianceOverAlpha = false;
        this.holes.material = hm;
        this.holes.isPickable = false;
        this.holes.alwaysSelectAsActiveMesh = true;
        this.holes.thinInstanceSetBuffer('matrix', new Float32Array(600 * 16), 16, false);
        this.holes.thinInstanceCount = 0;
        this.holes.isVisible = false;
        this.holeCount = 0;
        this._input();
    }

    get arm() { return ARMS[this.current]; }

    // The models, once: each turned so its grip is at the hand and it points ahead.
    async load() {
        const json = await (await fetch('assets/models/weapons/weapons.json')).json();
        const { scene } = this.world;
        await Promise.all(Object.entries(json).map(async ([key, j]: [string, any]) => {
            const { root } = await place(scene, 'weapons/' + j.file.replace(/\.glb$/, ''));
            root.computeWorldMatrix(true);
            const m = root.getWorldMatrix().clone();
            const p = (a) => V3.TransformCoordinates(V3.FromArray(a), m);
            const grip = p(j.grip), tip = p(j.tip), up = p(j.grip.map((x, i) => x + j.up[i])).subtract(grip).normalize();
            // (Ahead is along the bore, square to the model's up: a gun's muzzle is above its grip, and the line from one to
            // the other pointed the pistol 23 degrees down.)
            const forward = tip.subtract(grip).subtract(up.scale(V3.Dot(tip.subtract(grip), up))).normalize();
            // (Measured: turned only so, every model came out pointing back at the eye; half a turn about its own up
            // puts it the right way round.)
            const turn = Q.RotationAxis(V3.Up(), Math.PI).multiply(Q.Inverse(Q.FromLookDirectionLH(forward, up.subtract(forward.scale(V3.Dot(up, forward))).normalize())));
            const align = new BABYLON.TransformNode('hold_' + key, scene);
            align.rotationQuaternion = turn;
            align.position = grip.applyRotationQuaternion(turn).scale(-1);
            root.parent = align;
            align.parent = this.hand;
            for (const [name, keep] of Object.entries(SPLIT[key] ?? {})) for (const mesh of root.getChildMeshes()) split(mesh as BABYLON.Mesh, keep, name);
            for (const mesh of root.getChildMeshes()) {
                mesh.isPickable = false;
                mesh.receiveShadows = true;
                this.world.shadows?.addShadowCaster(mesh);
            }
            this._parts(key, align);
            align.setEnabled(false);
            this.models.set(key, align);
            // Where the muzzle and the port are, in the hand's frame.
            const local = (a) => (a ? p(a).applyRotationQuaternion(turn).add(align.position) : null);
            // (And for a blade, which way across it its edge is: weapons.json's `up` is its back.)
            const edge = j.up ? local(j.grip.map((x, i) => x - j.up[i])).subtract(local(j.grip)).normalize() : null;
            this._anchors.set(key, { tip: local(j.tip), ejection: local(j.ejection), eject: j.ejectDir ? V3.FromArray(j.ejectDir) : V3.Right(), edge });
            // The blood on a blade, and the blade's own material to show it on (the knife's blade is a mesh of its own; the
            // estoc is one mesh with its hilt, which would redden too, so its blood is not drawn).
            if (ARMS.find((a) => a.key === key)?.kind === 'blade') {
                const looks = root.getChildMeshes().filter((m) => /blade/.test(m.name) || /blade/.test(m.parent?.name ?? '')).map((mesh) => {
                    const own = (mesh.material as BABYLON.PBRMaterial).clone(`${mesh.material.name}_bloody`);
                    mesh.material = own;
                    return { material: own, albedo: own.albedoColor.clone(), metallic: own.metallic ?? 1, roughness: own.roughness ?? 1 };
                });
                this.blades.set(key, { wet: 0, held: 0, age: 0, at: null, v: null, looks });
            }
        }));
        // The arm a punch is thrown with: a working man's, in the sleeve of his jacket.
        if (this.world.people) this.fist = new Fist(this.world.people, 'sexton', this.world.camera, (m) => this.world.shadows?.addShadowCaster(m));
        // And both of them, holding whatever else is held (the right is the same arm).
        if (this.fist) this.hands = new Hands(this.world.people, 'sexton', this.world.camera, this.fist.arm, (m) => this.world.shadows?.addShadowCaster(m));
        for (const [key, node] of Object.entries(buildKit(this.world.scene))) {
            node.parent = this.hand;
            for (const mesh of node.getChildMeshes()) { mesh.isPickable = false; mesh.receiveShadows = true; }
            node.setEnabled(false);
            this.models.set(key, node);
        }
        this.select(this.slot);
    }

    // The slot at hand `i` (0 to 5) taken up: whatever is in it, or the bare hands.
    select(i) {
        if (i < 0 || i >= this.slots.length) return;
        this._letGo();
        this.fist?.stop();
        this.slot = i;
        this.current = ARMS.findIndex((a) => a.key === (this.slots[i] ?? 'hands'));
        this.action = null;
        this.reloading = 0;
        for (const [key, node] of this.models) node.setEnabled(key === this.arm.key);
        for (const blade of this.blades.values()) blade.at = blade.v = null;
        for (const parts of this.parts.values()) for (const part of Object.values(parts)) this._move(part);
        this.since = Infinity;
        this._animate(0);
    }

    // The moving parts of model `key` (PARTS), under `align`: each node where it is, and how its parent's frame lies in
    // the hand's (which is the model's own: z along the bore, the grip at nought).
    _parts(key: string, align: BABYLON.TransformNode) {
        const names = PARTS[key];
        if (!names) return;
        const fresh = (node: BABYLON.Node) => {
            const chain: BABYLON.Node[] = [];
            for (let n = node; n; n = n.parent) chain.unshift(n);
            for (const n of chain) (n as BABYLON.TransformNode).computeWorldMatrix?.(true);
        };
        fresh(align);
        const home = this.hand.getWorldMatrix().clone().invert(), parts: Record<string, Part> = {};
        for (const [name, test] of Object.entries(names)) {
            const nodes = align.getDescendants(false).filter((n) => test.test(n.name)) as BABYLON.TransformNode[];
            if (!nodes.length) continue;
            const min = new V3(Infinity, Infinity, Infinity), max = min.scale(-1);
            parts[name] = { min, max, nodes: nodes.map((node) => {
                fresh(node);
                for (const m of [node, ...node.getChildMeshes()]) {
                    if (!(m instanceof BABYLON.AbstractMesh)) continue;
                    fresh(m);
                    for (const v of m.getBoundingInfo().boundingBox.vectorsWorld) {
                        const h = V3.TransformCoordinates(v, home);
                        min.minimizeInPlace(h); max.maximizeInPlace(h);
                    }
                }
                node.rotationQuaternion ??= Q.FromEulerVector(node.rotation);
                return { node, at: node.position.clone(), turn: node.rotationQuaternion.clone(), size: node.scaling.clone(),
                    local: (node.parent as BABYLON.TransformNode).getWorldMatrix().multiply(home).invert() };
            }) };
        }
        this.parts.set(key, parts);
    }

    // A part moved `by` (in the hand's frame, m) and turned `angle` about the line `axis` through `pivot` (the hand's frame);
    // with nothing given, back where it was made. `shown` false hides it (a magazine dropped, a pin pulled).
    _move(part: Part | undefined, by?: BABYLON.Vector3, turn?: { axis: BABYLON.Vector3; pivot: BABYLON.Vector3; angle: number }, shown = true) {
        if (!part) return;
        for (const n of part.nodes) {
            // (its own scale, not 1: the Desert Eagle's parts are scaled up 100 times in their nodes, as FBX2glTF wrote them)
            if (shown) n.node.scaling.copyFrom(n.size); else n.node.scaling.setAll(0);
            if (!by && !turn) { n.node.position.copyFrom(n.at); n.node.rotationQuaternion.copyFrom(n.turn); continue; }
            const local = n.local, toHand = local.clone().invert();
            let at = V3.TransformCoordinates(n.at, toHand), q = n.turn;
            if (turn) {
                const r = Q.RotationAxis(turn.axis, turn.angle);
                at = turn.pivot.add(at.subtract(turn.pivot).applyRotationQuaternion(r));
                // (the glTF root mirrors z: a turn in the hand's frame is the other way round in the part's)
                q = Q.RotationAxis(V3.TransformNormal(turn.axis, local).normalize(), turn.angle * Math.sign(local.determinant())).multiply(n.turn);
            }
            if (by) at.addInPlace(by);
            n.node.position.copyFrom(V3.TransformCoordinates(at, local));
            n.node.rotationQuaternion.copyFrom(q);
        }
    }

    _input() {
        const { canvas } = this.world;
        const down = (e) => {
            if (document.pointerLockElement !== canvas) return;
            if (e.button === 0) this.firing = true;
            this._press(e.button);
        };
        const up = (e) => { if (e.button === 0) { this.firing = false; this._letGo(); } };
        const key = (e) => {
            if (document.pointerLockElement !== canvas) return;
            if (/^Digit[1-6]$/.test(e.code)) this.select(Number(e.code.slice(5)) - 1);
            if (e.code === 'KeyR') this._reload();
            if (e.code === 'KeyE') this.take(this.looking());
            if (e.code === 'KeyG') this.putBack();
        };
        const wheel = (e) => this.select((this.slot + (e.deltaY > 0 ? 1 : -1) + this.slots.length) % this.slots.length);
        // Pointer events, not mouse ones: Babylon cancels pointerdown, and a cancelled pointerdown has no mousedown after it.
        canvas.addEventListener('pointerdown', down);
        window.addEventListener('pointerup', up);
        window.addEventListener('keydown', key);
        canvas.addEventListener('wheel', wheel, { passive: true });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _press(button) {
        const arm = this.arm;
        if (this.busy > 0 || this.reloading > 0) return;
        if (arm.kind === 'gun' && button === 0) this._fire();
        else if (arm.kind === 'blade') this._swing(button === 0 ? 'stab' : 'cut');
        else if (arm.kind === 'blunt' && button === 0) this._swing('blow');
        else if (arm.kind === 'blunt' && button === 2 && arm.down) this._swing('down');
        else if (arm.kind === 'grab' && button === 0) this._take();
        else if (arm.kind === 'grab' && button === 2) this._punch();
        else if (arm.kind === 'throw') button === 0 ? this._throw() : (this.throwKind = (this.throwKind + 1) % THROWN.length);
        else if (arm.kind === 'grenade') this._lob(button === 0 ? 14 : 6);
    }

    // --- what is carried ----------------------------------------------------------------------

    // What on the arsenal the eye is on, if anything.
    looking(): string | null {
        if (!this.arsenal) return null;
        const { camera } = this.world;
        return this.arsenal.look(camera.globalPosition, camera.getDirection(V3.Forward()));
    }

    // `key` from the arsenal into the hand: into the slot held if it is empty, else the first empty one, else in place
    // of what is held (which goes back on the wall). What is carried already is just taken up.
    take(key: string | null) {
        if (!key) return;
        const have = this.slots.indexOf(key);
        if (have >= 0) { this.select(have); return; }
        const into = this.slots[this.slot] === null ? this.slot : this.slots.indexOf(null);
        this.slots[into >= 0 ? into : this.slot] = key;
        this.select(into >= 0 ? into : this.slot);
        this.world.sound?.shot('rack', { gain: 0.35, rate: 1.3 });
    }

    // What is held, back on the wall.
    putBack() {
        if (this.slots[this.slot] === null) return;
        this.slots[this.slot] = null;
        this.select(this.slot);
    }

    // Two places swapped (from the inventory screen): `list` 'slots' or 'bag'.
    move(fromList: 'slots' | 'bag', from: number, toList: 'slots' | 'bag', to: number) {
        const a = this[fromList], b = this[toList];
        [a[from], b[to]] = [b[to], a[from]];
        this.select(this.slot);
    }

    // --- guns ---------------------------------------------------------------------------

    _fire() {
        const { key, gun } = this.arm;
        if (this.ammo.get(key) <= 0) { this._reload(); return; }
        this.ammo.set(key, this.ammo.get(key) - 1);
        this.busy = gun.every;
        this.recoil = 1;
        const { camera, sound } = this.world;
        const eye = camera.globalPosition.clone(), ahead = camera.getDirection(V3.Forward());
        // A shotgun's charge flies as one mass for the first metre or so before the pellets part: up to about 1.2 m it
        // makes one round hole 2 to 2.5 cm across and goes in as a single heavy missile, wrecking everything along a
        // wide track (dev/research/wounds.md). Further off, the pellets go their own ways.
        const near = gun.pellets > 1 ? this._person(eye, ahead, 1.4) : null;
        if (near && near.t + 0.5 < 1.3) {
            const off = near.t + 0.5;
            this._shot(eye, jitter(ahead, gun.spread * 0.05), { ...gun, energy: gun.energy * gun.pellets * (1 - off * 0.1), mass: gun.mass * gun.pellets,
                calibre: off < 0.6 ? 0.022 : 0.026, channel: 0.024, soft: 42, hard: 120, pellets: 1 });
        } else for (let p = 0; p < gun.pellets; p++) this._shot(eye, jitter(ahead, gun.spread), { ...gun });
        sound?.shot(gun.sound, { gain: 1 });
        // The flash at the muzzle, one frame (muzzle.ts), and the light it throws, going by the clock (update).
        const anchors = this._anchors.get(key);
        const tip = anchors?.tip ?? new V3(0, 0, 0.6);
        const muzzle = V3.TransformCoordinates(tip, this.hand.getWorldMatrix());
        this.flash.position.copyFrom(muzzle);
        this.flash.intensity = this.muzzle.fire(key, tip, muzzle, ahead);
        this.flashAt = performance.now();
        this.flash.range = 8;
        this.world.player.pitch -= gun.kick * (0.6 + Math.random() * 0.4);
        this.world.player.yaw += (Math.random() - 0.5) * gun.kick * 0.4;
        if (key !== 'shotgun' && anchors?.ejection) this._eject(anchors, key);
        // The bolt worked for the next round as _cycle shows it: up and back, then forward and down.
        if (key === 'rifle') for (const [ms, name] of [[250, 'bolt-open'], [500, 'bolt-close']] as const) setTimeout(() => sound?.shot(name, { gain: 0.8 }), ms);
    }

    // One bullet or pellet from `from` along `dir`, followed through whoever it goes through.
    _shot(from: BABYLON.Vector3, dir: BABYLON.Vector3, m: Gun) {
        let origin = from.clone(), energy = m.energy;
        for (let leg = 0; leg < 6 && energy > 15; leg++) {
            const wall = this._wall(origin, dir);
            const person = this._person(origin, dir, wall ? wall.distance : 200);
            if (!person) {
                if (!wall) return;
                this._hole(wall.point, wall.normal, m.calibre);
                // Soft lead meeting concrete at a glancing angle skips off it, leaving lower than it came and slower
                // (Haag, Shooting Incident Reconstruction: ricochet angles are smaller than incidence angles). Below
                // `skips` (radians) it goes on; the angle and the 40% of its energy it keeps are estimates.
                const into = -V3.Dot(dir, wall.normal);
                if (!m.skips || into <= 0 || Math.asin(Math.min(1, into)) > m.skips) return;
                dir = dir.add(wall.normal.scale(into * 1.5)).normalize();
                origin = wall.point.add(wall.normal.scale(0.005));
                energy *= 0.4;
                continue;
            }
            const res = pierce(person.npc, origin, dir, { ...m, energy }, Math.min(3, (wall?.distance ?? 200) - person.t + 2) + person.t);
            if (!res.hit) { origin = origin.add(dir.scale(person.t + 0.3)); continue; }
            if (res.stopped || !res.at) return;
            energy = res.energy;
            origin = res.at.add(dir.scale(0.02));
        }
    }

    // The nearest person a line could meet: tested against their segments first, which is cheap.
    _person(origin, dir, far) {
        let best = null;
        for (const npc of this.world.npcs) {
            for (const seg of npc.ragdoll.segments) {
                const [a, b] = npc.ragdoll.segmentEnds(seg);
                const { t, distance } = rayToSegment(origin, dir, a, b);
                if (t > 0 && t < far && distance < seg.radius + 0.12 && (!best || t < best.t)) best = { npc, t: Math.max(0, t - 0.5) };
            }
        }
        return best;
    }

    // The room's walls, floor and fixed things: where a line meets them.
    _wall(origin, dir) {
        const pick = this.world.scene.pickWithRay(new BABYLON.Ray(origin, dir, 200), (m) => m.metadata?.solid);
        if (!pick?.hit) return null;
        return { distance: pick.distance, point: pick.pickedPoint, normal: pick.getNormal(true) ?? dir.scale(-1) };
    }

    _hole(at, normal, calibre) {
        const n = normal.normalize();
        const side = V3.Cross(n, Math.abs(n.y) > 0.9 ? V3.Right() : V3.Up()).normalize();
        const across = V3.Cross(n, side).normalize();
        const s = calibre * 2.4;
        const m = BABYLON.Matrix.FromValues(side.x * s, side.y * s, side.z * s, 0, across.x * s, across.y * s, across.z * s, 0, -n.x, -n.y, -n.z, 0,
            at.x + n.x * 0.001, at.y + n.y * 0.001, at.z + n.z * 0.001, 1);
        this.holes.thinInstanceSetMatrixAt(this.holeCount % 600, m, true);
        this.holeCount++;
        this.holes.thinInstanceCount = Math.min(600, this.holeCount);
        this.holes.isVisible = true;
    }

    _eject(anchors, key) {
        const { scene, sound } = this.world;
        const at = V3.TransformCoordinates(anchors.ejection, this.hand.getWorldMatrix());
        // (.50 AE: 32.6 mm long, 13.9 mm across its base; .22 LR: 15.6 mm by 5.7 mm)
        const long = { rifle: [0.051, 0.012], ak: [0.039, 0.0113], m4: [0.045, 0.0096], deagle: [0.0326, 0.0139], r22: [0.0156, 0.0057] }[key] ?? [0.019, 0.0098];
        const brass = BABYLON.MeshBuilder.CreateCylinder('casing', { height: long[0], diameter: long[1], tessellation: 10 }, scene);
        brass.material = scene.getMaterialByName('brass') ?? Object.assign(new BABYLON.PBRMaterial('brass', scene), { albedoColor: new BABYLON.Color3(0.78, 0.56, 0.24), metallic: 1, roughness: 0.3 });
        brass.position.copyFrom(at);
        const body = new BABYLON.PhysicsAggregate(brass, BABYLON.PhysicsShapeType.CYLINDER, { mass: 0.01, restitution: 0.4, friction: 0.6 }, scene);
        const right = this.world.camera.getDirection(V3.Right()), up = this.world.camera.getDirection(V3.Up());
        body.body.setLinearVelocity(right.scale(2 + Math.random()).add(up.scale(1.5 + Math.random())));
        body.body.setAngularVelocity(new V3(Math.random() * 20, Math.random() * 20, 0));
        this.casings.push({ mesh: brass, body });
        if (this.casings.length > 40) { const old = this.casings.shift(); old.body.dispose(); old.mesh.dispose(); }
        setTimeout(() => sound?.shot('casing', { at: brass.position.asArray(), gain: 0.5 }), 500 + Math.random() * 200);
    }

    _reload() {
        const { key, gun } = this.arm;
        if (!gun || this.reloading > 0 || this.ammo.get(key) === gun.rounds) return;
        this.reloading = gun.reload;
    }

    // --- blades and the bat -----------------------------------------------------------------

    _swing(how) {
        const arm = this.arm;
        this.busy = how === 'stab' ? 0.35 : arm.swing;
        this.action = { how, t: 0, length: this.busy, hits: new Map(), landed: false };
        this.world.sound?.shot(arm.whoosh ?? 'swing', { gain: how === 'stab' ? 0.5 : 0.9, rate: arm.key === 'knife' ? 1.25 : arm.key === 'hammer' ? 1.2 : 1 });
        if (how === 'stab') {
            const { camera } = this.world;
            const eye = camera.globalPosition.clone(), ahead = camera.getDirection(V3.Forward());
            const person = this._person(eye, ahead, arm.reach);
            if (!person) return;
            const skin = person.npc.surface(eye, ahead, arm.reach).find((h) => h.kind === 'skin');
            if (!skin) return;
            setTimeout(() => {
                const edge = this._anchors.get(arm.key)?.edge;
                const across = edge ? V3.TransformNormal(edge, this.hand.getWorldMatrix()).normalize() : undefined;
                const res = pierce(person.npc, eye, ahead, { ...arm.stab, across }, arm.reach + arm.stab.reach);
                // The blade comes out with blood over what went in, both faces, about as wide as it is.
                if (res.hit && res.enter) this._bloody(arm.key, Math.min(arm.stab.reach, res.at ? V3.Distance(res.enter.point, res.at) : arm.stab.reach) * arm.stab.calibre);
                this.world.sound?.shot('stab', { at: skin.point.asArray() });
            }, 90);
        }
    }

    // A cut or a blow under way: a fan of lines from the eye, swept from right to left over the middle of the swing.
    _sweep(dt) {
        const a = this.action, arm = this.arm;
        a.t += dt;
        const p = a.t / a.length;
        if (p < 0.2 || p > 0.75 || a.how === 'stab') return;
        // From overhead it lands only as it comes down onto the line of sight, half way through.
        if (a.how === 'down' && (p < 0.45 || p > 0.6)) return;
        const { camera } = this.world;
        const eye = camera.globalPosition.clone();
        const turn = 0.75 - ((p - 0.2) / 0.55) * 1.5;
        const dir = a.how === 'down' ? camera.getDirection(V3.Forward())
            : V3.TransformNormal(new V3(Math.sin(turn), -0.12 + (p - 0.2) * 0.35, Math.cos(turn)).normalize(), camera.getWorldMatrix());
        const person = this._person(eye, dir, arm.reach);
        if (!person) return;
        const npc = person.npc;
        if (a.how === 'blow' || a.how === 'down') {
            if (a.landed) return;
            const skin = npc.surface(eye, dir, arm.reach).find((h) => h.kind === 'skin' || h.kind === 'cloth');
            if (!skin) return;
            a.landed = true;
            // The bat moves across the eye's line, and on into them; a blow from overhead comes down and forward.
            const across = V3.TransformNormal(new V3(a.how === 'down' ? 0 : -1, a.how === 'down' ? -0.8 : 0, a.how === 'down' ? 0.6 : 0.35).normalize(), camera.getWorldMatrix());
            const down = a.how === 'down' ? arm.down : null;
            if (down?.claw) {
                // The claw's tines driven in (a puncture), along the way it comes down.
                const res = pierce(npc, skin.point.subtract(across.scale(0.05)), across, { ...down.claw, across: camera.getDirection(V3.Right()) }, 0.05 + down.claw.reach);
                if (res.hit) this.world.sound?.shot('stab', { at: skin.point.asArray() });
            } else {
                blow(npc, skin.point, across, arm.mass, down?.speed ?? arm.speed, down?.tool ?? arm.tool);
                this.world.sound?.shot(arm.sound ?? 'blunt', { at: skin.point.asArray() });
                // The shovel's edge also splits the skin over what it broke: a chop, drawn as a short cut across it.
                if (down?.cut) {
                    const res = pierce(npc, skin.point.subtract(across.scale(0.05)), across, { energy: 60, mass: 0.3, calibre: 0.004, channel: down.cut * 0.5, soft: 0.8, hard: 60,
                        reach: down.cut, blade: true, slash: true }, 0.05 + down.cut);
                    if (res.hit && res.enter) a.hits.set(npc, [res.enter]);
                }
            }
            this.action.t = Math.max(this.action.t, this.action.length * 0.75);
            return;
        }
        const res = pierce(npc, eye, dir, { energy: arm.key === 'sword' ? 90 : 35, mass: 0.3, calibre: 0.004, channel: arm.cut * 0.5, soft: 0.8, hard: 60, reach: arm.cut,
            blade: true, slash: true }, arm.reach + arm.cut);
        if (!res.hit || !res.enter) return;
        // The cut itself is made once the swing is through, along every place it crossed the skin (npc.slash).
        if (!a.hits.has(npc)) { a.hits.set(npc, []); this.world.sound?.shot('skin', { at: res.enter.point.asArray(), gain: 0.9 }); }
        a.hits.get(npc).push(res.enter);
        // Nothing is thrown out of the cut as it is made (no pressure behind it); the blade picks blood up as it goes
        // through, a few centimetres of its edge in the flesh at a time (an estimate), and casts it off as it swings (_shed).
        this._bloody(arm.key, arm.cut * 0.03);
    }

    // --- hands: picking a body up and dragging it -------------------------------------------

    _take() {
        const { camera } = this.world;
        const eye = camera.globalPosition.clone(), ahead = camera.getDirection(V3.Forward());
        // Bowel that has come out is taken hold of before the body it came out of.
        const bowel = viscera.pick(this.world.npcs, eye, ahead, 3);
        if (bowel) { this.grab = { bowel, distance: bowel.distance }; return; }
        const person = this._person(eye, ahead, 3);
        if (person) {
            const skin = person.npc.surface(eye, ahead, 3)[0];
            if (!skin) return;
            person.npc.grabbed = true;
            person.npc.knockDown();
            const { seg } = person.npc.ragdoll.nearest(skin.point);
            const local = V3.TransformCoordinates(skin.point, seg.node.computeWorldMatrix(true).clone().invert());
            this.grab = { body: seg.body, node: seg.node, local, distance: V3.Distance(eye, skin.point), mass: seg.mass, npc: person.npc };
            return;
        }
        // Or a thing.
        const pick = this.world.scene.pickWithRay(new BABYLON.Ray(eye, ahead, 3), (m) => !!m.physicsBody && m.physicsBody.getMotionType() === BABYLON.PhysicsMotionType.DYNAMIC);
        if (pick?.hit) {
            const node = pick.pickedMesh as BABYLON.Mesh;
            const local = V3.TransformCoordinates(pick.pickedPoint, node.computeWorldMatrix(true).clone().invert());
            this.grab = { body: node.physicsBody, node, local, distance: pick.distance, mass: node.physicsBody.getMassProperties().mass ?? 1 };
        }
    }

    // A punch: an untrained man's, 500 to 850 N, about 45 J behind a fist and forearm (dev/research/blunt-trauma.md). It
    // lands when the fist gets there (fist.ts), on whatever is in front of the eye then.
    _punch() {
        this.busy = 0.42;
        const { camera } = this.world, reach = 0.85;
        const look = () => {
            const eye = camera.globalPosition.clone(), ahead = camera.getDirection(V3.Forward());
            const person = this._person(eye, ahead, reach + 0.08);
            const hit = person?.npc.surface(eye, ahead, reach + 0.08).find((h) => h.kind === 'skin' || h.kind === 'cloth');
            return hit ? { npc: person.npc, hit, ahead, far: V3.Distance(eye, hit.point) } : null;
        };
        const aim = () => {
            this.world.sound?.shot('swing', { gain: 0.35, rate: 1.4 });
            const at = look();
            return at && at.far <= reach ? at.far : null;
        };
        // Whatever is in front of the eye where the knuckles are when they get there, or a little short of it (they came
        // on into the fist): how far ahead its skin is, where the fist stops.
        const land = (speed: number, ahead: number) => {
            const at = look();
            if (!at || at.far > ahead + 0.03 || at.far < ahead - 0.08) return null;
            // A fist and the arm behind it give: about 9 kN/m, which is what makes 1.8 kg at the 5 m/s it lands at
            // (fist.ts) land with the 500 to 850 N an untrained punch is measured at (dev/research/blunt-trauma.md), not
            // with the force of a brick.
            blow(at.npc, at.hit.point, at.ahead, 1.8, speed, 9000);
            this.world.sound?.shot('blunt', { at: at.hit.point.asArray(), gain: 0.6 });
            return at.far;
        };
        if (this.fist) { this.fist.punch({ aim, land }); return; }
        const ahead = aim();
        if (ahead !== null) setTimeout(() => land(5.25, ahead), 110);
    }

    _hold(dt) {
        const g = this.grab;
        if (!g) return;
        const { camera } = this.world;
        const target = camera.globalPosition.add(camera.getDirection(V3.Forward()).scale(Math.min(g.distance, 2.2)));
        if (g.bowel) { viscera.pull(g.bowel, target); return; }
        const at = V3.TransformCoordinates(g.local, g.node.computeWorldMatrix(true));
        const v = g.body.getLinearVelocity();
        // A stiff spring on the point that was taken hold of, damped, as strong as two arms.
        const force = target.subtract(at).scale(320 * Math.min(g.mass, 12)).subtract(v.scale(28 * Math.min(g.mass, 12)));
        const most = 900;
        if (force.length() > most) force.scaleInPlace(most / force.length());
        g.body.applyImpulse(force.scale(dt), at);
    }

    _letGo() {
        if (!this.grab) return;
        if (this.grab.npc) this.grab.npc.grabbed = false;
        if (this.grab.bowel) viscera.letGo(this.grab.bowel);
        this.grab = null;
    }

    // --- throwing things ---------------------------------------------------------------------

    async _throw() {
        const { scene, camera, models, bodyOf } = this.world;
        const [name, mass, stiffness] = THROWN[this.throwKind];
        this.busy = 0.35;
        await models.prepare([name]);
        const source = models.sources.get(name);
        if (!source) return;
        const mesh = source.createInstance(name + '_thrown');
        mesh.isPickable = true;
        const ahead = camera.getDirection(V3.Forward());
        mesh.position.copyFrom(camera.globalPosition.add(ahead.scale(0.8)).add(new V3(0, -0.25, 0)));
        mesh.rotation.set(Math.random(), Math.random() * 6, 0);
        this.world.shadows?.addShadowCaster(mesh);
        const agg = new BABYLON.PhysicsAggregate(mesh, BABYLON.PhysicsShapeType.CONVEX_HULL, { mass, friction: 0.6, restitution: 0.15 }, scene);
        agg.body.setLinearVelocity(ahead.scale(mass > 4 ? 9 : 13));
        agg.body.setAngularVelocity(new V3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3));
        agg.body.setCollisionCallbackEnabled(true);
        let last = 0;
        agg.body.getCollisionObservable().add((e) => {
            const who = bodyOf.get(e.collidedAgainst);
            const speed = agg.body.getLinearVelocity().length();
            const now = performance.now();
            if (!who || speed < 3 || now - last < 250) return;
            last = now;
            blow(who.npc, e.point ?? who.seg.node.position, agg.body.getLinearVelocity().normalize(), mass, speed, stiffness);
            this.world.sound?.shot('blunt', { at: (e.point ?? mesh.position).asArray(), gain: Math.min(1, speed / 10) });
        });
        this.thrown.push({ mesh, agg });
        if (this.thrown.length > 30) { const old = this.thrown.shift(); old.agg.dispose(); old.mesh.dispose(); }
    }

    get throwing() { return THROWN[this.throwKind][0].replace(/_\d+$/, '').replace(/_/g, ' '); }

    // --- the grenade ----------------------------------------------------------------------------

    // An M67: pin out, lever off as it leaves the hand, and a fuse of four to five and a half seconds. Thrown overarm
    // (left) or rolled underhand (right) at `speed` m/s.
    _lob(speed: number) {
        const { scene, camera, sound, bodyOf } = this.world;
        const model = this.models.get('grenade');
        if (!model) return;
        this.busy = 0.9;
        sound?.shot('pin', { gain: 0.7 });
        setTimeout(() => {
            const ahead = camera.getDirection(V3.Forward()), up = camera.getDirection(V3.Up());
            const node = model.instantiateHierarchy(null, { doNotInstantiate: true });
            node.parent = null;
            node.setEnabled(true);
            for (const m of node.getChildMeshes()) m.setEnabled(true);  // (the one in the hand is hidden as it leaves it)
            node.position.copyFrom(camera.globalPosition.add(ahead.scale(0.4)).add(up.scale(speed > 10 ? 0.1 : -0.3)));
            const meshes = node.getChildMeshes();
            for (const m of meshes) this.world.shadows?.addShadowCaster(m);
            // The physics on a sphere the size of the body (64 mm across, 400 g) that carries the model with it.
            const ball = BABYLON.MeshBuilder.CreateSphere('grenade', { diameter: 0.064, segments: 6 }, scene);
            ball.isVisible = false;
            ball.isPickable = false;
            ball.position.copyFrom(node.position);
            node.position.setAll(0);
            node.parent = ball;
            const agg = new BABYLON.PhysicsAggregate(ball, BABYLON.PhysicsShapeType.SPHERE, { mass: 0.4, friction: 0.7, restitution: 0.3 }, scene);
            agg.body.setLinearVelocity(ahead.scale(speed).add(up.scale(speed > 10 ? 2.5 : 0)));
            agg.body.setAngularVelocity(new V3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5));
            agg.body.setAngularDamping(0.6);
            agg.body.setCollisionCallbackEnabled(true);
            let last = 0;
            agg.body.getCollisionObservable().add((e) => {
                const v = agg.body.getLinearVelocity().length(), now = performance.now();
                if (v < 1.2 || now - last < 120) return;
                last = now;
                this.world.sound?.shot('bounce-metal', { at: ball.position.asArray(), gain: Math.min(1, v / 8) });
                const who = bodyOf.get(e.collidedAgainst);
                if (who && v > 5) blow(who.npc, e.point ?? ball.position, agg.body.getLinearVelocity().normalize(), 0.4, v,);
            });
            this.grenades.push({ ball, node, agg, fuse: 4 + Math.random() * 1.5 });
        }, 220);
    }

    _fuses(dt) {
        for (const g of this.grenades) if ((g.fuse -= dt) <= 0) this._explode(g);
        this.grenades = this.grenades.filter((g) => g.fuse > 0);
    }

    // 180 g of Composition B in a steel body that breaks into a few hundred fragments: killing within 5 m, wounding to
    // 15. The blast throws and knocks down whoever is close; the fragments go out every way as missiles of their own.
    _explode(g) {
        const { scene, sound, player } = this.world;
        const at = g.ball.position.clone();
        g.agg.dispose();
        g.node.dispose();  // its clones wear the grenade model's own materials, still drawn on the wall and in the hand
        g.ball.dispose();
        sound?.shot('explosion', { at: at.asArray(), gain: 1 });
        this.flash.position.copyFrom(at.add(new V3(0, 0.3, 0)));
        this.flash.range = 16;
        this.flash.intensity = 900;
        this.flashAt = performance.now();
        this.flashCard.position.copyFrom(at.add(new V3(0, 0.25, 0)));
        this.flashCard.scaling.setAll(6);
        this.flashCard.rotation.z = Math.random() * Math.PI;
        this.flashCard.setEnabled(true);
        smoke(scene, at);

        // The blast: an impulse on every part of everyone near, falling off with the square of the distance; limbs near
        // enough torn off and a belly burst (180 g of Composition B is about 0.25 kg of TNT).
        for (const npc of this.world.npcs) {
            blast(npc, at, 0.25);
            const centre = npc.ragdoll.centre, d = Math.max(0.4, V3.Distance(at, centre));
            if (d > 8) continue;
            const total = Math.min(60, 35 / (d * d));          // N s on the whole body
            for (const seg of npc.ragdoll.segments) {
                if (!seg.body) continue;
                const p = seg.node.getAbsolutePosition();
                const dir = p.subtract(at).normalize().add(new V3(0, 0.35, 0)).normalize();
                seg.body.applyImpulse(dir.scale(total * seg.mass / npc.ragdoll.mass), p);
            }
            if (d < 3.5) {
                npc.knockDown();
                const near = npc.ragdoll.nearest(at);
                const point = near.seg.node.getAbsolutePosition();
                blow(npc, point, point.subtract(at).normalize(), 2, Math.min(18, 12 / d), 'flat');
            }
        }

        // The fragments, about a thousand, each spending its energy against air first (half its speed in 15 m). Followed
        // one by one only where they meet somebody: each part of each person takes as many as the share of the sphere it
        // covers seen from the burst. A few hundred more go out every way, for the marks they leave on the room.
        const frag: Gun = { name: 'fragment', energy: 330, mass: 0.0003, speed: 1500, calibre: 0.004, channel: 0.004, soft: 18, hard: 110, rounds: 0, every: 0,
            pellets: 1, spread: 0, kick: 0, sound: '', reload: 0 };
        const fly = (dir: BABYLON.Vector3, far: number) => this._shot(at, dir, { ...frag, energy: frag.energy * Math.exp(-far / 10.8) });
        for (const npc of this.world.npcs) {
            for (const seg of npc.ragdoll.segments) {
                const [a, b] = npc.ragdoll.segmentEnds(seg), mid = a.add(b).scale(0.5), d = V3.Distance(at, mid);
                if (d > 25) continue;
                const area = 2 * seg.radius * (V3.Distance(a, b) + 2 * seg.radius);
                const expected = FRAGMENTS * area / (4 * Math.PI * d * d);
                for (let n = Math.floor(expected + Math.random()); n > 0; n--) {
                    const aim = V3.Lerp(a, b, Math.random()).add(new V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).scale(seg.radius * 1.6));
                    fly(aim.subtract(at).normalize(), Math.max(0, d - 0.3));
                }
            }
        }
        for (let i = 0; i < 160; i++) {
            const y = Math.random() * 1.6 - 0.6, r = Math.sqrt(1 - y * y), a = Math.random() * Math.PI * 2;
            const dir = new V3(Math.cos(a) * r, y, Math.sin(a) * r);
            if (!this._person(at, dir, 25)) fly(dir, 0);
        }

        // The player feels it.
        const d = V3.Distance(at, this.world.camera.globalPosition);
        if (d < 14) {
            player.pitch -= (Math.random() * 0.08 + 0.04) * Math.min(1, 3 / d);
            player.yaw += (Math.random() - 0.5) * 0.08 * Math.min(1, 3 / d);
        }
    }

    // --- every frame --------------------------------------------------------------------------

    update(dt) {
        this.busy = Math.max(0, this.busy - dt);
        if (this.reloading > 0) {
            // Each stroke of the reload heard as the hands do it (RELOADS), then the gun is full.
            const gun = this.arm.gun, was = 1 - this.reloading / gun.reload;
            this.reloading -= dt;
            const now = 1 - this.reloading / gun.reload;
            for (const [u, name] of RELOADS[this.arm.key] ?? []) if (u > was && u <= now) this.world.sound?.shot(name, { gain: name === 'round-in' ? 0.6 : 0.85 });
            if (this.reloading <= 0) this.ammo.set(this.arm.key, gun.rounds);
        }
        if (this.firing && this.arm.key === 'pistol' && this.busy <= 0) this.firing = false;
        // Held down, an automatic keeps firing until it is empty.
        if (this.firing && this.arm.gun?.auto && this.busy <= 0 && this.reloading <= 0) {
            if (this.ammo.get(this.arm.key) > 0) this._fire();
            else { this.firing = false; this._reload(); }
        }
        this._fuses(dt);
        if (this.action) {
            this._sweep(dt);
            if (this.action.t >= this.action.length) {
                const sweep = this.world.camera.getDirection(V3.Left());
                for (const [npc, hits] of this.action.hits) npc.slash(hits, this.arm.cut ?? this.arm.down?.cut ?? 0.02, sweep);
                this.action = null;
            }
        }
        this._hold(dt);
        this.fist?.update(dt);
        this.medic.update(dt);
        // The flash goes as fast as it came.
        // By the clock, not by frames: a frame held up by a limb coming off must not keep a flash on screen.
        if (this.flash.intensity > 0) {
            const age = (performance.now() - this.flashAt) / 1000;
            this.flash.intensity *= Math.exp(-age * 40);
            if (this.flash.intensity < 1 || age > 0.12) { this.flash.intensity = 0; this.flashCard.setEnabled(false); }
        }
        this._animate(dt);
        this._shed(dt);
    }

    // Blood onto blade `key`: a film over `area` square metres of it, both faces.
    _bloody(key, area) {
        const blade = this.blades.get(key);
        if (!blade) return;
        blade.wet += 2 * area * FILM * 1e6;
        // (The smear is a film over the blade, as thick however often it has been in: it does not pile up.)
        blade.held = Math.min(blade.wet, Math.max(blade.held, 2 * area * SMEAR * 1e6));
        blade.age = 0;
    }

    // The blood on the blade in hand, every frame (dev/research/stab-wounds.md sec. 2). It feels gravity less the blade's
    // own acceleration, and a drop d across stays on only while surface tension can hold it there, rho (pi d^3 / 6) a <
    // pi sigma d: so whatever is more than the smear that stays, and makes drops of d = sqrt(6 sigma / (rho a)) or more,
    // leaves, at the tip's speed and on along its path (Williams et al. 2019: cast-off drops leave tangent to the
    // weapon's path at its speed, not flung out from its middle). Held still it drips (a = g: drops of 5.7 mm); a sharp
    // stop or turn sheds a line of smaller ones. Its first stab's way back out is the first that can (none before it).
    _shed(dt) {
        const blade = this.blades.get(this.arm.key), tip = this._anchors.get(this.arm.key)?.tip;
        if (!blade || !tip || dt <= 0) return;
        if (blade.wet > 0) this._stain(blade, dt);
        const at = V3.TransformCoordinates(tip, this.hand.computeWorldMatrix(true));
        const v = blade.at ? at.subtract(blade.at).scale(1 / dt) : null;
        const a = v && blade.v ? v.subtract(blade.v).scale(1 / dt) : null;
        blade.at = at;
        blade.v = v;
        // (While a stab's blade is still in the wound, the wound holds what is on it: its animation brings the point back
        // out of the skin about three quarters of the way through.)
        const free = blade.wet - blade.held, inside = this.action?.how === 'stab' && this.action.t < this.action.length * 0.75;
        if (!a || free <= 0 || inside) return;
        const d = Math.sqrt((6 * GAMMA) / (RHO * Math.hypot(a.x, a.y + 9.81, a.z))), each = volume(d);
        if (free < each) return;
        const ml = Math.floor(free / each) * each, speed = v.length();
        blade.wet -= ml;
        this.world.blood.spray(at, speed > 0.05 ? v.scale(1 / speed) : V3.Down(), speed, ml, 0.05, d / 0.0016);
    }

    // The blade reddened by the blood on it, wet and glossy, going dull and brown as it dries.
    _stain(blade, dt) {
        blade.age += dt;
        const cover = Math.min(1, blade.wet / 0.03), dry = Math.min(1, blade.age / DRIES);
        const blood = BABYLON.Color3.Lerp(new BABYLON.Color3(0.3, 0.02, 0.018), new BABYLON.Color3(0.17, 0.07, 0.05), dry);
        for (const look of blade.looks) {
            const m = look.material as BABYLON.PBRMaterial;
            BABYLON.Color3.LerpToRef(look.albedo, blood, cover, m.albedoColor);
            m.metallic = look.metallic * (1 - cover);
            m.roughness = look.roughness + (0.15 + 0.55 * dry - look.roughness) * cover;
        }
    }

    // The thing in the hands and the hands on it, every frame. At rest as HELD has it, breathing and swaying a little,
    // carried along by the walk and lagging behind a turn of the head; kicked back from its grip by a shot; carried
    // through a stab or a cut; worked through a reload by the hands that really do it. The arms follow the hands
    // (hands.ts), so whatever moves the thing moves them.
    _animate(dt) {
        const key = this.arm.key, held = HELD[key], hands = this.hands;
        if (!held) {
            hands?.put('L', null);
            if (!(this.fist?.t >= 0)) hands?.put('R', null);
            return;
        }
        const { player } = this.world;
        this.clock += dt;
        this.since = this.recoil === 1 ? 0 : this.since + dt;
        this.recoil *= Math.exp(-dt * 14);
        // Where it is and how it is turned before anything else moves it: at rest, or along a swing.
        const pos = V3.FromArray(held.at), base = held.turn ? V3.FromArray(held.turn) : null, turn = V3.Zero();
        const hold: { right: Grip | null; left: Grip | null } = { right: held.right ?? null, left: held.left ?? null };
        if (this.action && SWINGS[key]?.[this.action.how]) {
            const keys = SWINGS[key][this.action.how], p = Math.min(1, this.action.t / this.action.length);
            const from = [0, ...held.at, ...held.turn], to = from.map((v, i) => (i ? v : 1));
            const all = [from, ...keys, to];
            let k = 1;
            while (k < all.length - 1 && all[k][0] <= p) k++;
            const a = all[k - 1], b = all[k], u = smooth((p - a[0]) / (b[0] - a[0]));
            pos.set(lerp(a[1], b[1], u), lerp(a[2], b[2], u), lerp(a[3], b[3], u));
            base.set(lerp(a[4], b[4], u), lerp(a[5], b[5], u), lerp(a[6], b[6], u));
        }

        // Breath, a little sway, the walk (a figure of eight over each pair of steps), and the look: the hands lag a turn
        // of the head and catch up (its rate eased over a tenth of a second).
        const going = Math.min(1, player.speed / 1.55) * (player.running ? 1.6 : 1), step = player.bobPhase, breath = Math.sin(player.breathing);
        pos.x += Math.sin(step) * 0.008 * going + Math.sin(this.clock * 0.8) * 0.0012;
        pos.y += (Math.cos(2 * step) - 1) * 0.004 * going + breath * 0.0025;
        turn.x += breath * 0.006 + Math.sin(this.clock * 0.55) * 0.002;
        turn.y += Math.sin(this.clock * 0.7) * 0.003 + Math.sin(step) * 0.012 * going;
        turn.z += Math.sin(step) * 0.02 * going;
        const lag = this.lag, most = (v: number, m: number) => Math.max(-m, Math.min(m, v));
        if (dt > 0) {
            const ease = Math.min(1, dt * 10);
            lag.x += ((player.yaw - lag.yaw) / dt - lag.x) * ease;
            lag.y += ((player.pitch - lag.pitch) / dt - lag.y) * ease;
        }
        lag.yaw = player.yaw;
        lag.pitch = player.pitch;
        turn.y -= most(lag.x * 0.03, 0.08);
        turn.x -= most(lag.y * 0.03, 0.08);
        pos.x -= most(lag.x * 0.008, 0.02);
        pos.y += most(lag.y * 0.008, 0.02);

        // A shot: the gun driven back into the hands and turned up about its grip, the pistol's slide run back.
        const [back, rise] = held.kick ?? [0, 0];
        pos.z -= this.recoil * back;
        pos.y += this.recoil * back * 0.3;
        turn.x -= this.recoil * rise;
        const parts = this.parts.get(key);
        if (SLIDE[key]) this._move(parts?.slide, new V3(0, 0, -SLIDE[key] * Math.max(0, this.recoil * 2 - 1)));
        if (this.arm.gun && this.reloading > 0) this._reloading(key, 1 - this.reloading / this.arm.gun.reload, pos, turn, hold, parts);
        else if (key === 'rifle' && this.since < 0.9) this._cycle(this.since, pos, turn, hold, parts);
        if (key === 'grenade') this._lobbing(this.busy > 0 ? 0.9 - this.busy : -1, pos, base, hold, parts);

        // A dressing being put on: the roll taken to the wound and wound round it, the other hand off it; the kit held low, open.
        const dressing = this.medic.working;
        if (dressing !== null) {
            const s = Math.min(1, dressing * 8), t = this.medic.clock * 6;
            if (key === 'bandage') {
                pos.addInPlace(new V3(-0.08 + Math.cos(t) * 0.05, 0.05 + Math.sin(t) * 0.04, 0.2).scale(s));
                turn.x += Math.sin(t) * 0.3 * s;
                if (s > 0.5) hold.left = null;
            } else { pos.y -= 0.1 * s; pos.z += 0.05 * s; turn.x += 0.7 * s; turn.z += Math.sin(t) * 0.05 * s; }
        }

        const q = (base ? Q.FromEulerAngles(base.x, base.y, base.z) : this._aim(pos, key)).multiply(Q.FromEulerAngles(turn.x, turn.y, turn.z));
        this.hand.position.copyFrom(pos);
        this.hand.rotationQuaternion = q;
        if (!hands) return;
        const frame = this.hand.computeWorldMatrix(true);
        hands.put('R', hold.right, frame);
        hands.put('L', hold.left, frame);
    }

    // A gun turned so that its bore, from where it is held at `at`, runs to the point AIMED metres ahead of the eye.
    _aim(at: BABYLON.Vector3, key: string) {
        const tip = this._anchors.get(key)?.tip, bore = tip ? new V3(tip.x, tip.y, 0) : V3.Zero();
        let q = Q.Identity();
        for (let k = 0; k < 2; k++) {
            const z = new V3(0, 0, AIMED).subtract(at.add(bore.applyRotationQuaternion(q))).normalize();
            const y = V3.Up().subtract(z.scale(z.y)).normalize();
            q = Q.RotationQuaternionFromAxis(V3.Cross(y, z), y, z);
        }
        return q;
    }

    // A reload, `u` of the way through (0 to 1), done by the hands: the gun tipped in toward the other hand, which takes
    // the magazine out and down, comes back up with a full one and seats it, and works the slide or the charging handle;
    // the bolt rifle's bolt opened, five rounds thumbed in and the bolt closed; the shotgun opened, shells out and in. The
    // gun is then back where it was. Its parts move with the hand on them.
    _reloading(key: string, u: number, pos: BABYLON.Vector3, turn: BABYLON.Vector3, hold: { right: Grip | null; left: Grip | null }, parts?: Record<string, Part>) {
        const rest = HELD[key], tip = span(u, 0, 0.14) - span(u, 0.84, 1);
        if (key === 'rifle') return this._bolt(u, pos, turn, hold, parts, true);
        const shotgun = key === 'shotgun';
        // Tipped in: the magazine well (or the open breech) turned toward the other hand, brought in and up a little.
        // (Turned about the grip: a long gun pitched down there would bring its stock up into the face. The shotgun's
        // barrels drop; the gun itself only comes in and down a little.)
        pos.addInPlace(new V3(-0.05, shotgun ? -0.03 : 0.04, -0.05).scale(tip));
        turn.z += (shotgun ? 0.2 : SLIDE[key] ? 0.45 : 0.5) * tip;
        turn.x += (shotgun ? 0.1 : -0.15) * tip;
        const mag = parts?.mag, below = [-0.06, -0.4, -0.12];
        const well = mag ? [(mag.min.x + mag.max.x) / 2, mag.min.y + 0.03, (mag.min.z + mag.max.z) / 2]
            : shotgun ? [0, 0.08, 0.03] : [0, -0.06, 0.1];
        const onMag = (by: number[]): Grip => ({ hold: 'handle', at: well.map((v, i) => v + by[i]), along: [0, -0.3, -0.95], back: [0.35, -0.9, 0.2] });
        const gone = (g: Grip): Grip => ({ ...g, at: g.at.map((v, i) => v + below[i]) });
        const support = rest.left;
        let out: number[] | null = null;    // where the magazine is from home, or null for not drawn
        if (shotgun) {
            // Broken open (the barrels and forend turn down about the hinge pin at the front of the action, the hand on
            // the forend taking them down), the spent shells drawn out at the breech, two new ones fetched and pushed in,
            // and closed by the hand on the forend, with a flick of the gun.
            const barrels = parts?.barrels, pivot = new V3(0, barrels ? barrels.min.y + 0.01 : 0.04, barrels ? barrels.min.z : 0.15);
            const open = 0.55 * (span(u, 0.12, 0.22) - span(u, 0.76, 0.84)), r = Q.RotationAxis(V3.Right(), open);
            const turned = (g: Grip): Grip => ({ hold: g.hold, at: V3.FromArray(g.at).subtract(pivot).applyRotationQuaternion(r).add(pivot).asArray(),
                along: V3.FromArray(g.along).applyRotationQuaternion(r).asArray(), back: V3.FromArray(g.back).applyRotationQuaternion(r).asArray() });
            this._move(barrels, undefined, { axis: V3.Right(), pivot, angle: open });
            const breech = turned({ hold: 'pinch', at: [0, pivot.y + 0.045, pivot.z + 0.01], along: [0, -0.4, -0.9], back: [0.9, 0, 0.4] });
            hold.left = blend(blend(blend(blend(turned(support), breech, span(u, 0.22, 0.3)), gone(breech), span(u, 0.32, 0.46)), breech, span(u, 0.5, 0.64)),
                turned(support), span(u, 0.66, 0.74));
            turn.x -= 0.25 * (span(u, 0.8, 0.84) - span(u, 0.84, 0.92));
            return;
        }
        // Out: drawn down and away by the hand (from a pistol it falls free), the hand gone below the picture for a full
        // one, up and into the well, pushed home.
        const drop = !!SLIDE[key], low = [0, -0.42, -0.1], drawn = [0, -0.12, 0.02];
        const mix = (x: number[], y: number[], s: number) => x.map((v, i) => lerp(v, y[i], s));
        const seat = mix(mix(low, [0, -0.06, 0], span(u, 0.42, 0.62)), [0, 0, 0], span(u, 0.62, 0.7));
        const fell = Math.max(0, u - 0.1) * this.arm.gun.reload;
        if (drop) out = u < 0.42 ? (fell < 0.25 ? [0, -4.9 * fell * fell, 0] : null) : seat;
        else out = u < 0.26 ? drawn.map((v) => v * span(u, 0.12, 0.26)) : u < 0.42 ? mix(drawn, low, span(u, 0.26, 0.4)) : seat;
        hold.left = drop ? (u < 0.42 ? blend(support, onMag(low), span(u, 0, 0.14)) : onMag(out))
            : blend(support, onMag(out ?? low), span(u, 0, 0.12));
        // Then the slide (pistol: over the top, from behind) or the charging handle (rifles) pulled back and let go.
        const pull = span(u, 0.76, 0.82) - span(u, 0.82, 0.84);
        if (SLIDE[key]) {
            const slide = parts?.slide, grab: Grip = { hold: 'wrap', at: [0, slide ? slide.max.y - 0.012 : 0.06, slide ? slide.min.z + 0.03 : -0.02], along: [0, 0, 1], back: [1, -0.3, 0] };
            this._move(slide, new V3(0, 0, -SLIDE[key] * pull));
            hold.left = blend(blend(hold.left, grab, span(u, 0.7, 0.76)), support, span(u, 0.86, 0.98));
            hold.left = { ...hold.left, at: hold.left.at.map((v, i) => v - (i === 2 ? SLIDE[key] * pull * span(u, 0.7, 0.76) : 0)) };
        } else {
            const handle = parts?.handle, at = handle ? [(handle.min.x + handle.max.x) / 2, handle.max.y, handle.max.z] : [0.03, 0.09, 0.08];
            const travel = key === 'r22' ? 0.038 : 0.07;    // a 10/22's bolt comes back about 1.5 in
            const grab: Grip = { hold: 'pinch', at: at.map((v, i) => v - (i === 2 ? travel * pull : 0)), along: [0, -0.5, -0.85], back: [0.3, 0.2, 0.93] };
            this._move(handle, new V3(0, 0, -travel * pull));
            hold.left = blend(blend(hold.left, grab, span(u, 0.7, 0.76)), support, span(u, 0.86, 1));
        }
        this._move(mag, out ? V3.FromArray(out) : undefined, undefined, !!out);
    }

    // The bolt rifle's bolt worked by the right hand (a reload, `u` through it, with five rounds pushed in by the left
    // between; or a round chambered after a shot, `cycle`).
    _bolt(u: number, pos: BABYLON.Vector3, turn: BABYLON.Vector3, hold: { right: Grip | null; left: Grip | null }, parts: Record<string, Part> | undefined, reload: boolean) {
        const rest = HELD.rifle, bolt = parts?.bolt, tip = this._anchors.get('rifle')?.tip;
        // When each stroke is, as fractions of the whole: hand to the knob, lift, back, (rounds in), forward, down, hand back.
        const at = reload ? [0, 0.1, 0.16, 0.26, 0.78, 0.86, 0.92, 1] : [0.13, 0.28, 0.36, 0.5, 0.55, 0.67, 0.74, 0.94];
        const lift = span(u, at[1], at[2]) - span(u, at[5], at[6]), draw = span(u, at[2], at[3]) - span(u, at[4], at[5]);
        const knob = bolt ? [bolt.max.x, (bolt.min.y + bolt.max.y) / 2, bolt.max.z - 0.01] : [0.06, 0.03, 0.05];
        const angle = -1.1 * lift, axis = new V3(0, 0, 1), pivot = new V3(tip?.x ?? 0, tip?.y ?? 0.05, 0);
        const moved = V3.FromArray(knob).subtract(pivot).applyRotationQuaternion(Q.RotationAxis(axis, angle)).add(pivot).add(new V3(0, 0, -0.085 * draw));
        this._move(bolt, new V3(0, 0, -0.085 * draw), { axis, pivot, angle });
        const onKnob: Grip = { hold: 'pinch', at: moved.asArray(), along: [0.2, -0.5, -0.85], back: [0.3, 0.9, 0.3] };
        hold.right = blend(blend(rest.right, onKnob, span(u, at[0], at[1])), rest.right, span(u, at[6], at[7]));
        const tipIn = span(u, at[0], at[1]) - span(u, at[6], at[7]);
        turn.z += (reload ? 0.3 : 0.12) * tipIn;
        pos.addInPlace(new V3(-0.02, 0.01, -0.02).scale(tipIn));
        if (!reload) return;
        // Five rounds pressed down into the magazine through the open action, one after another.
        const port: Grip = { hold: 'pinch', at: [0, 0.07 - 0.015 * Math.max(0, Math.sin(Math.PI * 5 * span(u, 0.34, 0.72))), 0.02], along: [0, -0.3, -0.95], back: [0.95, 0.2, 0] };
        hold.left = blend(blend(rest.left, port, span(u, 0.26, 0.34)), rest.left, span(u, 0.72, 0.82));
    }

    _cycle(t: number, pos: BABYLON.Vector3, turn: BABYLON.Vector3, hold: { right: Grip | null; left: Grip | null }, parts?: Record<string, Part>) {
        this._bolt(t / 0.9, pos, turn, hold, parts, false);
    }

    // The grenade thrown, `t` seconds in (-1: not being thrown): the other hand pulls the pin by its ring, the throwing
    // hand draws back beside the head and comes over and forward, letting go at 0.22 s (_lob), follows through and goes
    // down for another, which comes back up with its pin in.
    _lobbing(t: number, pos: BABYLON.Vector3, base: BABYLON.Vector3, hold: { right: Grip | null; left: Grip | null }, parts?: Record<string, Part>) {
        const model = this.models.get('grenade'), pin = parts?.pin;
        if (t < 0) { model?.getChildMeshes().forEach((m) => m.setEnabled(true)); this._move(pin); return; }
        const ring = pin ? [pin.max.x, (pin.min.y + pin.max.y) / 2, (pin.min.z + pin.max.z) / 2] : [0.02, 0, 0.04];
        const pulled = span(t, 0.06, 0.12);
        this._move(pin, new V3(0.08 * pulled, 0, 0), undefined, t < 0.13);
        const onRing: Grip = { hold: 'pinch', at: ring.map((v, i) => v + (i === 0 ? 0.08 * pulled : 0)), along: [0, 0, -1], back: [1, 0, 0] };
        hold.left = t < 0.2 ? blend({ ...onRing, at: [ring[0] + 0.05, ring[1] - 0.3, ring[2] - 0.1] }, onRing, span(t, 0, 0.06) - span(t, 0.13, 0.2)) : null;
        const held = HELD.grenade, cock = span(t, 0.1, 0.17), go = span(t, 0.17, 0.22), after = span(t, 0.22, 0.42), back = span(t, 0.72, 0.9);
        const at = V3.FromArray(held.at), up = new V3(0.24, 0.02, 0.12), out = new V3(0.06, 0.08, 0.55), down = new V3(0.15, -0.55, 0.3);
        pos.copyFrom(V3.Lerp(V3.Lerp(V3.Lerp(V3.Lerp(at, up, cock), out, go), down, after), at, back));
        base.x += -0.9 * cock + 1.6 * go;
        for (const m of model?.getChildMeshes() ?? []) m.setEnabled(t < 0.22 || t > 0.72);
        if (t > 0.72) this._move(pin);
    }
}

// A grey cloud where the grenade was, rising and spreading for a few seconds.
let smokeTexture: BABYLON.DynamicTexture | null = null;
function smoke(scene, at: BABYLON.Vector3) {
    if (!smokeTexture) {
        smokeTexture = new BABYLON.DynamicTexture('smoke', 64, scene, false);
        const ctx = smokeTexture.getContext();
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        smokeTexture.hasAlpha = true;
        smokeTexture.update();
    }
    const ps = new BABYLON.ParticleSystem('smoke', 90, scene);
    ps.particleTexture = smokeTexture;
    ps.emitter = at.add(new V3(0, 0.2, 0));
    ps.createSphereEmitter(0.3);
    ps.color1 = new BABYLON.Color4(0.55, 0.53, 0.5, 0.85);
    ps.color2 = new BABYLON.Color4(0.4, 0.39, 0.37, 0.75);
    ps.colorDead = new BABYLON.Color4(0.25, 0.25, 0.25, 0);
    ps.minSize = 0.9; ps.maxSize = 1.8;
    ps.addSizeGradient(0, 0.6);
    ps.addSizeGradient(1, 2.6);
    ps.minLifeTime = 2.5; ps.maxLifeTime = 4.5;
    ps.minEmitPower = 1.5; ps.maxEmitPower = 4;
    ps.gravity = new V3(0, 0.25, 0);
    ps.minAngularSpeed = -0.4; ps.maxAngularSpeed = 0.4;
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    ps.manualEmitCount = 90;
    ps.disposeOnStop = true;
    ps.targetStopDuration = 5;
    ps.start();
}

// The connected pieces of `mesh` (its triangles joined where their corners meet) that `keep` picks by their bounds in the
// mesh's own frame, cut out into a mesh of their own called `name` beside it.
function split(mesh: BABYLON.Mesh, keep: (lo: BABYLON.Vector3, hi: BABYLON.Vector3) => boolean, name: string) {
    const P = mesh.getVerticesData(BABYLON.VertexBuffer.PositionKind), I = mesh.getIndices();
    if (!P || !I) return null;
    const id = new Map<string, number>(), weld = new Int32Array(P.length / 3);
    for (let i = 0; i < weld.length; i++) {
        const k = `${Math.round(P[i * 3] * 1e4)},${Math.round(P[i * 3 + 1] * 1e4)},${Math.round(P[i * 3 + 2] * 1e4)}`;
        if (!id.has(k)) id.set(k, id.size);
        weld[i] = id.get(k);
    }
    const up = Array.from({ length: id.size }, (_, i) => i);
    const top = (x: number) => { while (up[x] !== x) x = up[x] = up[up[x]]; return x; };
    for (let t = 0; t < I.length; t += 3) {
        const a = top(weld[I[t]]);
        up[top(weld[I[t + 1]])] = a;
        up[top(weld[I[t + 2]])] = a;
    }
    const lo = new Map<number, BABYLON.Vector3>(), hi = new Map<number, BABYLON.Vector3>();
    for (let i = 0; i < weld.length; i++) {
        const r = top(weld[i]), v = V3.FromArray(P, i * 3);
        if (!lo.has(r)) { lo.set(r, v.clone()); hi.set(r, v.clone()); }
        lo.get(r).minimizeInPlace(v);
        hi.get(r).maximizeInPlace(v);
    }
    const picked = new Set([...lo.keys()].filter((r) => keep(lo.get(r), hi.get(r))));
    if (!picked.size) return null;
    const mine: number[] = [], rest: number[] = [];
    for (let t = 0; t < I.length; t += 3) (picked.has(top(weld[I[t]])) ? mine : rest).push(I[t], I[t + 1], I[t + 2]);
    mesh.makeGeometryUnique();
    const part = mesh.clone(name, mesh.parent) as BABYLON.Mesh;
    part.makeGeometryUnique();
    part.setIndices(mine);
    mesh.setIndices(rest);
    // (bounds from the corners the triangles use: a mesh's own are of every corner it has)
    const bounds = (keepIt: boolean) => {
        const a = new V3(Infinity, Infinity, Infinity), b = a.scale(-1);
        for (const r of lo.keys()) if (picked.has(r) === keepIt) { a.minimizeInPlace(lo.get(r)); b.maximizeInPlace(hi.get(r)); }
        return new BABYLON.BoundingInfo(a, b);
    };
    part.setBoundingInfo(bounds(true));
    mesh.setBoundingInfo(bounds(false));
    return part;
}

const lerp = (a: number, b: number, u: number) => a + (b - a) * u;
const smooth = (u: number) => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));
// 0 before `a`, 1 after `b`, smoothly between.
const span = (u: number, a: number, b: number) => smooth((u - a) / (b - a));

// A hand `s` of the way from grip `a` to grip `b` (closed as `a` until half way, then as `b`).
function blend(a: Grip | null, b: Grip | null, s: number): Grip | null {
    if (s <= 0 || !b) return s < 0.5 || !b ? a : b;
    if (s >= 1 || !a) return s >= 0.5 || !a ? b : a;
    const mix = (x: number[], y: number[]) => x.map((v, i) => lerp(v, y[i], s));
    return { hold: s < 0.5 ? a.hold : b.hold, at: mix(a.at, b.at), along: mix(a.along, b.along), back: mix(a.back, b.back) };
}

function jitter(dir: BABYLON.Vector3, spread: number) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    const side = V3.Cross(dir, V3.Up()).normalize(), up = V3.Cross(side, dir).normalize();
    return dir.add(side.scale(Math.cos(a) * r)).add(up.scale(Math.sin(a) * r)).normalize();
}

function flashTexture(scene) {
    const t = new BABYLON.DynamicTexture('flashStar', { width: 128, height: 128 }, scene, false);
    const g = t.getContext() as CanvasRenderingContext2D;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,250,230,1)');
    grad.addColorStop(0.25, 'rgba(255,190,90,0.9)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = grad;
    for (let k = 0; k < 5; k++) {
        g.save();
        g.translate(64, 64);
        g.rotate((k / 5) * Math.PI * 2 + 0.3);
        g.beginPath();
        g.moveTo(-6, 0); g.lineTo(0, -62); g.lineTo(6, 0);
        g.fill();
        g.restore();
    }
    g.beginPath(); g.arc(64, 64, 26, 0, Math.PI * 2); g.fill();
    t.hasAlpha = true;
    t.update();
    return t;
}

function holeTexture(scene) {
    const t = new BABYLON.DynamicTexture('bulletHole', { width: 64, height: 64 }, scene, true);
    const g = t.getContext() as CanvasRenderingContext2D;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(10,9,8,1)');
    grad.addColorStop(0.3, 'rgba(25,22,20,0.95)');
    grad.addColorStop(0.55, 'rgba(70,65,60,0.5)');
    grad.addColorStop(1, 'rgba(90,85,80,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    t.hasAlpha = true;
    t.update();
    return t;
}
