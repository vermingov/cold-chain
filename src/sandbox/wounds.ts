// What a bullet, a blade or a blow does to a person.
//
// A shot is a line through them. Along it, from the skin in, it goes through
// whatever is there: skin, fat, muscle, the bones and organs anatomy.ts
// knows, and past any vessel near enough to be torn by the wound channel. It
// spends its energy as it goes, a little on each centimetre of soft tissue and
// a great deal on bone, and stops where it has none left; what is left when it
// comes out the far side carries on to whatever is behind. Each thing hurt
// says what it does to the body (vitals.ts): a severed femoral artery bleeds a
// litre and a half a minute, a holed lung slowly collapses. What it does to a
// bone, and the bone to the body, is bones.ts's; the pieces of a bone it
// shatters fly on through the flesh like small bullets of their own (shards).
//
// A blow is an impulse into the segment it lands on and a force on the first
// bone in its way (bones.ts's impact).

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3;

export type Missile = {
    energy: number;         // joules at the skin
    mass: number;           // kg, for the push it gives
    calibre: number;        // metres across: the hole it makes
    channel: number;        // metres: how far either side of its path tissue is torn (the permanent cavity)
    soft: number;           // joules lost per centimetre of soft tissue
    hard: number;           // and of bone
    reach?: number;         // metres into the body it can go at most (a blade's length)
    blade?: boolean;
    slash?: boolean;        // drawn across rather than driven in: no hole, the caller draws the cut
};

// How big an organ is, roughly, through: to say how much of it a path of a given length wrecks.
const THROUGH = { heart: 0.1, lung: 0.16, liver: 0.15, spleen: 0.09, kidney: 0.07, brain: 0.14, stomach: 0.1, bowel: 0.2, colon: 0.15 };
// Litres a second an organ bleeds when holed through, before the heart's push is taken into account.
const ORGAN_BLEED = { heart: 0.07, liver: 0.012, spleen: 0.01, kidney: 0.007, lung: 0.004, brain: 0.002, pancreas: 0.003, stomach: 0.002, bowel: 0.0015,
    colon: 0.0015, gallbladder: 0.001, bladder: 0.0008, adrenal: 0.001, muscle: 0.001, airway: 0.001, oesophagus: 0.001, brainstem: 0.001 };

const FAT = 0.012;          // metres of fat under the skin, about
const SKIN = 0.002;

// The rate a vessel of radius r (metres) bleeds, cut through, at normal pressure: a carotid about a litre a minute.
const vesselRate = (r, arterial) => (arterial ? 1.2 : 0.55) * Math.pow(r * 1000, 2) * 0.001;

const cap = (s) => s[0].toUpperCase() + s.slice(1);

// A line from `origin` along unit `dir` through person `npc`, carrying `m`. Returns where it stopped (or left them)
// and the energy it still has.
export function pierce(npc, origin: BABYLON.Vector3, dir: BABYLON.Vector3, m: Missile, far = 3) {
    const surface = npc.surface(origin, dir, far);
    const skins = surface.filter((h) => h.kind === 'skin');
    if (!skins.length) {
        // Only clothes in the way (a sleeve standing off an arm): a hole in them and nothing else.
        for (const h of surface) npc.wound(h, 'in', m.calibre);
        return { stopped: false, at: null, energy: m.energy, hit: surface.length > 0 };
    }
    const { spans, vessels } = npc.insides.trace(origin, dir, far, m.channel);
    const v = npc.vitals;
    const first = v.bleeds.length;
    let energy = m.energy, stopAt = Infinity;
    const enter = skins[0];
    // Clothes before the skin are holed where it went in, and the blood from the wound soaks into them there.
    for (const h of surface) if (h.kind === 'cloth' && h.t <= enter.t + 0.02) { npc.wound(h, 'in', m.calibre); enter.cloth = h; }
    // The way in, opened in the flesh; round a bullet's, the ring of skin it scraped and bruised going in.
    if (!m.slash && !m.blade) npc.marks.hole(enter, m.calibre, false, ((m as any).speed ?? 0) < 600);
    // Blood on the skin round the way in, which is what a hole in a shirt over it shows.
    if (!m.slash) npc.marks.smear(enter, 0.008 + m.calibre * 0.6, 0.55);
    if (!m.slash) npc.wound(enter, m.blade ? 'stab' : 'in', m.blade ? m.calibre * 1.2 : m.calibre);
    // Where the path is inside the body: between each skin crossing and the next.
    const inside: [number, number][] = [];
    for (let k = 0; k < skins.length; k += 2) inside.push([skins[k].t, skins[k + 1]?.t ?? skins[k].t + 0.05]);
    const limit = m.reach ? enter.t + m.reach : Infinity;

    // Walk the path: soft tissue between the hard things, and the things themselves.
    let t = enter.t, bones = 0;
    const events = spans.filter((s) => s.enter < Math.min(far, limit) && inside.some(([a, b]) => s.enter < b && s.leave > a));
    const spend = (to, rate) => {
        const cm = (to - t) * 100;
        if (cm <= 0) return true;
        if (energy - cm * rate <= 0) { stopAt = t + energy / rate / 100; energy = 0; return false; }
        energy -= cm * rate;
        t = to;
        return true;
    };
    let fragments = 1;
    for (const s of events) {
        if (stopAt < Infinity) break;
        if (s.enter > t && !spend(Math.min(s.enter, limit), m.soft)) break;
        if (t >= limit) { stopAt = limit; break; }
        const length = Math.min(s.leave, limit) - Math.max(s.enter, t);
        const kind = s.part.kind;
        if (kind === 'bone' || kind === 'skull' || kind === 'cartilage') {
            const at = energy, point = origin.add(dir.scale(Math.max(t, s.enter)));
            // A blade is stopped by bone, and does not break it: a heavy one bites into it.
            if (m.blade) {
                if (at > 60) v.injure(`${cap(s.part.name)} notched by the blade`, 3);
                stopAt = Math.max(t, s.enter); energy = 0; break;
            }
            // (A bone is paid for by its thickness, not by how long the line runs inside it: the skull is several shells one
            // inside another, and a line along a long bone is not through it.)
            const thick = npc.bones.thickness(s.part.name);
            const held = !spend(Math.min(s.leave, limit, Math.max(t, s.enter) + thick), m.hard);
            const broke = npc.bones.shot(s.part, point, dir, at, m.calibre, s.leave - s.enter);
            if (broke.pieces) shards(npc, origin.add(dir.scale(Math.min(s.leave, held ? stopAt : s.leave))), dir, broke.pieces, (at - energy) * 0.3);
            if (held) break;
            t = Math.max(t, Math.min(s.leave, limit));
            bones++;
            fragments = Math.min(2, fragments + (broke.pieces ? 0.25 * broke.pieces : 0.2));
            continue;
        }
        organ(npc, s.part, length, m, fragments);
        if (!spend(Math.min(s.leave, limit), m.soft * (kind === 'liver' || kind === 'brain' ? 0.8 : 1))) break;
        if (t >= limit) { stopAt = limit; break; }
    }
    if (stopAt === Infinity) {
        // On to the far side of the body, through what flesh is left.
        const out = inside.find(([a, b]) => b > t)?.[1] ?? t;
        if (out < limit && spend(out, m.soft)) stopAt = Infinity;
        else if (stopAt === Infinity) stopAt = Math.min(out, limit);
    }

    // The teeth in its way, and the vessels the channel tore, up to where it stopped.
    if (!m.blade) npc.bones.teeth.shot(origin, dir, Math.min(stopAt, far));
    for (const hit of vessels) if (hit.t < stopAt) vessel(npc, hit, m);
    // The flesh itself: skin, fat and muscle bleed a little from any wound.
    const deep = Math.min(stopAt, inside[0][1]) - enter.t;
    v.bleed({ name: 'wound', rate: 0.00025 * (m.channel / 0.006) * Math.min(1, deep / 0.05 + 0.3), clots: 0.02, source: { mark: enter } });
    v.pain = Math.min(1, v.pain + 0.25 + (bones ? 0.25 : 0));
    const region = regionOf(npc, enter);
    v.injure(woundText(m, region, deep, stopAt === Infinity), 1 + Math.min(3, deep * 20));

    // Every crossing of the skin it got to: out of an arm and into the chest behind it, and out the far side.
    const exited = stopAt === Infinity;
    let exitAt = null, exitHit = null;
    skins.forEach((h, k) => {
        if (k === 0 || h.t >= stopAt || m.slash) return;
        const out = k % 2 === 1;
        npc.wound(h, out ? 'out' : 'in', m.calibre * (out ? 1.6 + fragments : 1));
        if (out) { exitAt = h.point; exitHit = h; }
    });
    if (exited) for (const h of surface) if (h.kind === 'cloth' && h.t > skins[skins.length - 1].t) {
        npc.wound(h, 'out', m.calibre * 2);
        if (exitHit) exitHit.cloth = h;
    }
    // The scalp and face are full of small vessels and bleed far more than a wound anywhere else of the same size.
    if (npc.ragdoll.nearest(enter.point).seg?.name === 'head') {
        v.bleed({ name: 'scalp', rate: 0.0012 * (m.blade ? 1.5 : 1), clots: 0.003, source: { mark: enter } });
        if (exitHit) v.bleed({ name: 'scalp', rate: 0.002, clots: 0.003, source: { mark: exitHit } });
    }
    if (!m.slash) {
        npc.welling(enter, m.blade ? 0.8 : 0.8 + m.energy / 1500);
        npc.welling(exitHit, 2 + m.energy / 500);
    }
    // What bleeds comes out of the wound: the way out if there is one, it being the bigger.
    for (const b of v.bleeds.slice(first)) b.source = { ...b.source, mark: b.source?.mark ?? exitHit ?? enter };
    // The push it gave: its momentum, as much of it as it left in the body.
    const share = m.energy > 0 ? (m.energy - energy) / m.energy : 1;
    const speed = Math.sqrt((2 * m.energy) / Math.max(1e-4, m.mass));
    npc.hit(enter.point, dir.scale(m.mass * speed * Math.sqrt(share)), m.blade ? 0.2 : 1);
    if (!m.slash) npc.spatter(enter, dir, exitAt, m, exited);
    return { stopped: !exited, at: exited ? exitAt : origin.add(dir.scale(Math.min(stopAt, far))), energy: exited ? energy : 0, hit: true, enter };
}

function organ(npc, part, length, m, fragments) {
    const v = npc.vitals, kind = part.kind;
    const size = THROUGH[kind] ?? 0.08;
    const wreck = Math.min(1, (length / size) * (m.channel / 0.006) * 0.4 * fragments);
    npc.insides.hurt(part.name);
    const name = cap(part.name);
    switch (kind) {
        case 'heart':
            v.pump = Math.max(0, v.pump - wreck * 2.2);
            v.bleed({ name: part.name, rate: ORGAN_BLEED.heart * (0.4 + wreck), arterial: true, internal: true, clots: 0 });
            if (wreck > 0.12) v.arrest('fibrillating');
            v.injure(wreck > 0.3 ? 'Heart torn open' : 'Heart wounded', 10);
            return;
        case 'brain':
            v.brainDamage += 0.08 + wreck * 0.7;
            v.bleed({ name: part.name, rate: ORGAN_BLEED.brain, internal: true, clots: 0.004 });
            v.injure(wreck > 0.3 ? 'Brain destroyed along the wound' : 'Brain injured', 10);
            return;
        case 'brainstem':
            v.dead = true;
            v.arrest('none');
            v.injure('Brainstem destroyed', 11);
            return;
        case 'lung': {
            const side = /left/.test(part.name) ? 'L' : 'R';
            v.lungs[`leak${side}`] = true;
            v.lungs[side] = Math.max(0.05, v.lungs[side] - wreck * 0.4);
            v.bleed({ name: part.name, rate: ORGAN_BLEED.lung * (0.5 + wreck), internal: true, clots: 0.003 });
            npc.coughsBlood = true;
            v.injure(`${name} punctured, collapsing`, 7);
            return;
        }
        case 'airway':
            v.airway = Math.max(0.1, v.airway - 0.5);
            npc.coughsBlood = true;
            v.injure('Windpipe holed', 7);
            break;
    }
    const rate = (ORGAN_BLEED[kind] ?? 0.001) * (0.3 + wreck);
    v.bleed({ name: part.name, rate, internal: true, clots: kind === 'liver' || kind === 'spleen' ? 0.002 : 0.006 });
    v.injure(`${name} ${wreck > 0.5 ? 'torn apart' : 'lacerated'}`, 3 + rate * 300);
}

function vessel(npc, hit, m) {
    const { tube } = hit;
    if (tube.cut.has(hit.at)) return;
    tube.cut.add(hit.at);
    const v = npc.vitals;
    const r = tube.points[hit.at].r;
    // A blade or a bullet that only grazed it opens it partly.
    const through = hit.miss < -r ? 1 : 0.5;
    if (tube.kind === 'cord') {
        const owner = tube.points[hit.at].owner.bone.name;
        v.paralysed.legs = true;
        if (owner === 'neck01') {
            v.paralysed.arms = true;
            v.breathing = false;
            v.injure('Spinal cord severed at the neck: cannot breathe', 11);
        } else v.injure('Spinal cord severed: legs paralysed', 9);
        return;
    }
    const arterial = tube.kind === 'artery';
    const inTrunk = /aorta|vena cava|iliac|subclavian/.test(tube.name);
    const name = cap(tube.name);
    v.bleed({ name: tube.name, rate: vesselRate(r, arterial) * through, arterial, internal: inTrunk, clots: arterial ? 0.004 : 0.012, spurts: arterial && !inTrunk,
        source: { tube, at: hit.at } });
    v.injure(`${name} ${through === 1 ? 'severed' : 'nicked'}`, arterial ? 8 + r * 300 : 5);
}

// The pieces of a bone a bullet shattered, driven on from `at` in a cone round `dir` with `energy` J between them: each
// a small missile of its own, tearing what lies within a few centimetres (Bartlett et al. 2000: bone fragments are the
// secondary missiles of a high-velocity wound).
function shards(npc, at: BABYLON.Vector3, dir: BABYLON.Vector3, count: number, energy: number) {
    const piece: Missile = { energy: energy / count, mass: 0.002, calibre: 0.004, channel: 0.003, soft: 4, hard: 200 };
    const side = V3.Cross(dir, Math.abs(dir.y) < 0.9 ? V3.Up() : V3.Right()).normalize(), up = V3.Cross(dir, side);
    for (let k = 0; k < count; k++) {
        const a = Math.random() * Math.PI * 2, spread = 0.15 + Math.random() * 0.45;
        const d = dir.add(side.scale(Math.cos(a) * spread)).add(up.scale(Math.sin(a) * spread)).normalize();
        const reach = Math.min(0.12, piece.energy / piece.soft / 100);
        if (reach < 0.01) continue;
        const { spans, vessels } = npc.insides.trace(at, d, reach, piece.channel);
        for (const s of spans) if (!/bone|skull|cartilage/.test(s.part.kind)) organ(npc, s.part, Math.min(s.leave, reach) - s.enter, piece, 1);
        for (const hit of vessels) vessel(npc, hit, piece);
    }
    if (count > 2) npc.vitals.injure('Bone shattered into the flesh around it', 4);
}

// Which part of the body a point of skin is on, in words.
function regionOf(npc, hit) {
    const seg = npc.ragdoll.nearest(hit.point).seg?.name ?? 'pelvis';
    const side = seg.endsWith('L') ? 'left ' : seg.endsWith('R') ? 'right ' : '';
    const base = seg.replace(/2?[LR]$/, '');
    const words = { head: 'head', chest: 'chest', belly: 'abdomen', pelvis: 'pelvis', upperarm: 'upper arm', forearm: 'forearm', hand: 'hand',
        thigh: 'thigh', shin: 'lower leg', foot: 'foot' };
    return side + (words[base] ?? base);
}

function woundText(m, region, deep, through) {
    if (m.slash) return deep < 0.012 ? `Cut to the ${region}` : `Deep cut to the ${region}`;
    if (m.blade) return deep < 0.025 ? `Cut to the ${region}` : `Stab wound to the ${region}, ${Math.round(deep * 100)} cm deep`;
    return through ? `Gunshot through the ${region}` : `Gunshot to the ${region}, bullet lodged`;
}

// --- blows -------------------------------------------------------------------------

// Something swung or thrown into person `npc` at `point`, moving along `dir` at `speed` m/s with `mass` kg behind it;
// `tool` what it is ('fist', 'bat', 'flat', 'edge': bones.ts's TOOLS) or how stiff (N/m), if it is not plainly a bat or
// a heavy thing (an empty cardboard box gives far more than the flesh, a fist and arm about 9 kN/m).
export function blow(npc, point: BABYLON.Vector3, dir: BABYLON.Vector3, mass: number, speed: number, tool?: number | string) {
    const v = npc.vitals, pain = v.pain;
    const first = v.bleeds.length;
    const { seg } = npc.ragdoll.nearest(point);
    const name = seg?.name ?? 'chest';
    const skin = npc.surface(point.subtract(dir.scale(0.25)), dir, 0.5).find((h) => h.kind === 'skin') ?? null;
    const energy = 0.5 * mass * speed * speed;
    const base = name.replace(/2?[LR]$/, '');
    // The bone first in its way takes the force the flesh over it lets through (bones.ts); the soft parts take the energy.
    if (seg) npc.bones.impact(seg, point, dir, mass, speed, tool);
    if (base === 'head') {
        v.concussion = Math.min(1, v.concussion + energy / 160);
        if (energy > 90) v.bleed({ name: 'scalp', rate: 0.0008, clots: 0.01 });
        v.injure(energy > 60 ? 'Head struck: knocked out' : 'Head struck', energy > 60 ? 6 : 3);
    } else if (base === 'belly' && energy > 140) {
        const organ = npc.insides.parts.find((p) => p.name === (Math.random() < 0.5 ? 'spleen' : 'liver'));
        if (organ) rupture(npc, organ, energy);
    } else if (base === 'chest' && energy > 120) {
        v.lungs.leakR = v.lungs.leakR || Math.random() < 0.3;
    }
    // One blow hurts as much as one blow can, whatever it broke.
    v.pain = Math.min(1, v.pain + energy / 400, pain + 0.45);
    v.injure(`Blunt blow to the ${regionOf(npc, { point })}`, 1 + energy / 100);
    npc.marks.bruise(skin, 0.03 + energy / 6000);
    if (skin) for (const b of v.bleeds.slice(first)) b.source = { mark: skin };
    npc.hit(point, dir.scale(mass * speed * 0.9), 0);
}

function rupture(npc, part, energy) {
    npc.insides.hurt(part.name);
    npc.vitals.bleed({ name: part.name, rate: ORGAN_BLEED[part.kind] * Math.min(1, energy / 300), internal: true, clots: 0.003 });
    npc.vitals.injure(`${cap(part.name)} ruptured by the blow`, 6);
}
