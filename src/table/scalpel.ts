// The scalpel, and the hand it is in.
//
// The mouse is the hand. Where it points on the body is where the point of
// the blade is; held down, the blade is in the skin, and drawn along it
// leaves a cut exactly where it went. In a wound it goes down to the bottom
// of it straight, as a blade does, and so cuts what is straight under where
// it went in. It is a blade and not a point: all of its edge that is in the
// flesh cuts, from the point back along the belly to where the steel comes
// out of the skin, deepest at the point. And it cuts only the way its edge
// runs. Drawn sideways, a blade that is in flesh does not cut sideways: the
// flesh holds it, and it swings round behind the hand like a caster until
// its edge is going the way the hand is, and then cuts that way. How deep is a matter of how slowly:
// a quick stroke scratches, a steady one goes through skin and fat, and one
// that crawls goes through the wall into whatever is under it. A second
// stroke down the same line goes deeper than the first did. A blade that
// has stopped sinks too, but slowly: a hand that pauses at the end of a
// stroke has eased off, and should not be punished with a hole.

import * as BABYLON from '@babylonjs/core';
import { Buf } from '../geometry.ts';

// How much deeper (of 1, the whole wall) a stroke goes, by how fast the
// blade is moving over the skin in metres a second.
const PRESS = [[0.012, 1.0], [0.025, 0.85], [0.05, 0.55], [0.1, 0.32], [0.2, 0.15]];
const STILL = { below: 0.006, sinks: 0.45 };     // a blade going slower than this is standing, and sinks so much a second
// How fast the blade is going is taken over this long, not frame to frame:
// a mouse moves in whole pixels, and a slow hand is a pixel now and then.
const OVER = 0.14;
// The pace of a stroke is remembered for about this long, so that slowing to
// a stop at the end of one is not taken for bearing down.
const PACE = 0.6;
const ORDINARY = 0.09;          // metres a second: a brisk, shallow stroke
const SETTLE = 0.1;             // seconds for a blade just put down to bear its full weight
const TILT = 0.7;               // radians the handle is held up off the skin
const STEADY = 6;               // how fast the handle comes round to where the hand would have it, a second
const SINKS = 9;                // how fast the point goes down into a wound, or comes up out of one, a second
const GRIP = 0.064;             // metres from the point to where the fingers hold it
const HOVER = 0.02;             // metres the point is carried off the skin when not cutting, back toward the eye
// How much a stroke has to run the way the edge does (the cosine between them) to begin to cut, and to cut fully.
const EDGE = { from: 0.5, full: 0.85 };
// A blade drawn sideways swings round as if trailing `trail` metres plus
// however much of its edge is in the flesh behind the hand: the deeper in,
// the more the flesh holds it to its line. But for the first `sets` metres
// of a stroke it is the hand that sets it the way the stroke goes, as a
// hand does before it bears down. Lifted, it goes back to the way the hand
// holds it at `relaxes` a second.
const SWING = { trail: 0.004, sets: 0.003, relaxes: 2 };
const SIDE = { over: 0.2 };       // radians past square to the arm that a handle may swing before it is turned over to the hand's side
// The fingers stay `clear` metres off the skin: a blade that goes deeper is
// stood up more steeply in the hand, as a hand does.
const CLEAR = 0.02;
const BEARS = 0.0035;           // metres the skin gives under the point of a blade that is in it
const STEEL = { colour: [0.77, 0.78, 0.8], rough: 0.24 };

const smooth = (from, to, x) => { const t = Math.max(0, Math.min(1, (x - from) / (to - from))); return t * t * (3 - 2 * t); };

function pressAt(speed) {
    if (speed <= PRESS[0][0]) return PRESS[0][1];
    for (let i = 1; i < PRESS.length; i++) {
        const [fast, light] = PRESS[i], [slow, heavy] = PRESS[i - 1];
        if (speed <= fast) return heavy + (light - heavy) * (speed - slow) / (fast - slow);
    }
    return PRESS[PRESS.length - 1][1];
}

// A number four handle with a number twenty-two blade on it, to the sizes
// of the real things. Its point is at the origin, it lies along +x toward
// the hand, its back is up (+y) and its edge down. `room` is what polished
// steel shows of the room it is in, or null for steel that shows nothing.
function scalpelMesh(scene, room) {
    const buf = new Buf();
    // The blade: a straight back, a bellied edge, four tenths of a millimetre thick.
    buf.extrude([[0, 0], [0.004, -0.0022], [0.012, -0.0048], [0.024, -0.0062], [0.036, -0.0058], [0.05, -0.004],
        [0.05, 0.0055], [0.018, 0.0055]], 0.0004, 0.05);
    // The handle's tongue that the blade's slot sits on, its neck, and the ribbed part the fingers hold.
    buf.box([0.022, -0.0012, -0.0007], [0.05, 0.0022, 0.0007], 0.05);
    buf.box([0.05, -0.004, -0.0011], [0.062, 0.0045, 0.0011], 0.05);
    buf.box([0.062, -0.005, -0.0012], [0.106, 0.0055, 0.0012], 0.05);
    for (let rib = 0.065; rib < 0.104; rib += 0.0042) buf.box([rib, -0.0046, -0.00155], [rib + 0.0013, 0.0051, 0.00155], 0.05);
    // The rest of it: flat, and tapering to a rounded end.
    buf.extrude([[0.106, -0.005], [0.172, -0.0038], [0.178, -0.002], [0.178, 0.003], [0.172, 0.0048], [0.106, 0.0055]], 0.0024, 0.05);
    const material = new BABYLON.PBRMaterial('steel', scene);
    material.albedoColor = BABYLON.Color3.FromArray(STEEL.colour);
    material.metallic = room ? 1 : 0;
    material.roughness = STEEL.rough;
    material.reflectionTexture = room;
    material.environmentIntensity = room ? 1 : 0;
    const mesh = buf.toMesh('scalpel', scene, material);
    mesh.useVertexColors = false;
    mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
    return mesh;
}

// Inside the body the blade cuts what it is drawn across: a vessel is
// severed once the edge has crossed this much of it, and anything else is
// marked wherever it is touched.
const ACROSS = 0.003;
const REACHES = 0.015;          // metres of fat round what the edge is on that it goes through as well
const BEHIND = 0.035;           // and metres on down the blade's line, past what it is on, that it goes through to
const ARRIVED = 0.004;          // metres short of a thing inside at which the point counts as on it
// On the skin, a stroke that would have gone this much deeper than the wall
// is thick (of 1) has gone into what lies under it.
const TOO_DEEP = 0.3;

export class Scalpel {
    declare scene: any;
    declare camera: any;
    declare field: any;
    declare inside: any;
    declare arm: any;
    declare on: { thing: any; travelled: number; at: any; };
    declare cutting: any;
    declare severed: number;
    declare mesh: BABYLON.Mesh;
    declare lie: any;
    declare stands: any;
    declare sunk: number;
    declare level: any;
    declare pointer: any[];
    declare down: boolean;
    declare at: any[];
    declare travel: BABYLON.Vector3;
    declare speed: number;
    declare trail: any[];
    declare pace: number;
    declare contact: number;
    declare tip: any;
    declare tilt: number;
    declare drawn: number;
    declare clock: any;

    // `field` is the body's (field.js) and `inside` what is in it
    // (inside.js), or null for a body that cannot be opened. `arm` is the
    // arm whose hand it is in (arm.js) and `room` what its steel shows of
    // the room: without them it is a blade in the air.
    constructor(scene, camera, field, inside = null, { arm = null, room = null } = {}) {
        this.scene = scene;
        this.camera = camera;
        this.field = field;
        this.inside = inside;
        this.arm = arm;
        this.on = null;             // what the blade is on inside the body: { thing, travelled, at }
        this.cutting = null;        // what it is cutting this frame, for whoever makes the sound of it: 'skin', 'fat', 'flesh', 'bone', 'organ'
        this.severed = 0;           // how many vessels it has cut through
        this.mesh = scalpelMesh(scene, room);
        this.lie = null;            // the way its handle lies along whatever it is on
        this.stands = null;         // which way what it is on faces, as the hand has come round to it
        this.sunk = 0;              // metres its point is down the mouse's ray from the skin's old surface, in a wound
        this.level = field.top;     // how high the skin was where the mouse last left the body
        this.pointer = null;        // where the mouse is on the canvas: [x, y]
        this.down = false;
        this.at = null;             // where on the field the blade is: [u, v]
        this.travel = new BABYLON.Vector3(0, 0, -1);     // the way it was last drawn, along the skin
        this.speed = 0;             // metres a second over the skin
        this.trail = [];            // where the point has been lately: { at, when }
        this.pace = 0;              // the same, but slow to fall: how fast this stroke has been going
        this.contact = 0;           // seconds the blade has been in
        this.tip = null;            // where its point is in the world
        this.tilt = TILT;           // radians the handle is up off the skin just now
        this.drawn = 0;             // metres this stroke has been drawn
    }

    show(shown) {
        this.mesh.setEnabled(shown);
        if (this.arm && !shown) this.arm.reach(null);
    }

    aim(x, y) { this.pointer = [x, y]; }

    press(down) {
        if (down && !this.down) {
            this.field.begin();
            this.drawn = 0;
            // How fast it goes is how fast this stroke goes: not how fast the hand came to where it went in.
            this.trail.length = 0;
            this.at = null;
            this.contact = 0;
            // Until it has shown otherwise, a stroke is taken to be an ordinary one.
            this.pace = ORDINARY;
        }
        this.down = down;
    }

    update(dt) {
        this.cutting = null;
        if (!this.pointer) return;
        const ray = this.scene.createPickingRay(this.pointer[0], this.pointer[1], null, this.camera);
        const hit = this.field.hit(ray), met = this.inside && this.inside.meet(ray);
        if (met) {
            this._within(met, hit, ray, dt);
            return;
        }
        this.on = null;
        // The skin dimples under a point that bears on it, and lets go when the blade lifts or goes in.
        const blade = this.field.blade;
        if (hit) { blade.u = hit.u; blade.v = hit.v; }
        blade.sinks += ((hit && this.down && this.field.sunkAt(hit.u, hit.v) <= 0 ? BEARS : 0) - blade.sinks) * Math.min(1, dt * 18);
        if (!hit) {
            // Off the body the hand still goes where the mouse does, at the height it left the body at.
            this.at = null;
            this.trail.length = 0;
            if (ray.direction.y < -0.05) this._hold(ray.origin.add(ray.direction.scale((this.level - ray.origin.y) / ray.direction.y)), BABYLON.Vector3.Up(), ray, 0, dt, BABYLON.Vector3.Down());
            return;
        }
        const here = [hit.u, hit.v];
        if (this.at) {
            const moved = hit.point.subtract(this.field.point(...this.at));
            const went = moved.length();
            this.speed = this._speed(hit.point, dt);
            this.pace = Math.max(this.speed, this.pace - this.pace * dt / PACE);
            if (went > 0.0015) this.travel = BABYLON.Vector3.Lerp(this.travel, moved.scale(1 / went), 0.35).normalize();
            if (this.down) {
                this.contact += dt;
                const settled = Math.min(1, this.contact / SETTLE), weight = settled * settled * (3 - 2 * settled);
                // A frame in which a moving blade has not moved is the gap
                // between two pixels of a slow stroke, and cuts nothing.
                // The blade comes round to the stroke first; then however much of the stroke its edge leads
                // is what it cuts: drawn along itself a blade cuts, drawn sideways it does not.
                if (went > 0) this._swing(moved, this.field.normal(...here), hit.point);
                this.drawn += went;
                const edge = went > 0 && this.lie ? smooth(EDGE.from, EDGE.full, Math.abs(BABYLON.Vector3.Dot(moved, this.lie)) / went) : 0;
                if (this.speed < STILL.below) {
                    // Held still, it sinks: the point, and the belly behind it, which opens a slit along it.
                    this.field.dwell(here, STILL.sinks * dt * weight);
                    this._edge(here, hit.point, STILL.sinks * dt * weight);
                } else if (edge > 0) {
                    // Drawn, the edge behind the point runs down the line the point has just cut.
                    if (this.field.cut(this.at, here, pressAt(this.pace) * weight * edge) > TOO_DEEP && this.inside) this.inside.under(hit.point);
                    this.cutting = this.field.knife.point;
                } else if (went > 0) this.field.liftBlade();
            }
        }
        this.at = here;
        this.level = hit.point.y;
        // In a wound, the point is at the bottom of it, straight down from where it went in.
        const normal = this.field.normal(hit.u, hit.v);
        this._hold(hit.point, normal, ray, this.field.sunkAt(hit.u, hit.v), dt, normal.negate());
    }

    // How much of the edge is in the flesh, in metres back from the point
    // along the belly: as deep as the point is, at the angle it is held.
    _inFlesh() {
        return (this.sunk + 0.002) / Math.tan(this.tilt);
    }

    // The rest of the edge that is in the flesh cuts too: from the point
    // back along the belly to where the steel comes out of the skin, less
    // deep the further from the point. (`press` is how much deeper the point
    // goes, of the whole wall.)
    _edge(here, point, press) {
        if (!this.lie || press <= 0) return;
        const length = this._inFlesh(), parts = 3, knife = this.field.knife, stroke = knife.mark();
        let from = here;
        for (let k = 1; k <= parts; k++) {
            const along = point.add(this.lie.scale(length * k / parts)), to = this.field.place(along.x, along.z);
            this.field.cut(from, to, press * (1 - (k - 0.5) / parts));
            from = to;
        }
        // (The stroke goes on from the point, not from the far end of the edge.)
        knife.resume(stroke);
    }

    // A blade in flesh drawn sideways is held to its line at the point and
    // swings round behind the hand, as a caster does: the way the handle
    // lies comes round toward the way it is being drawn, whichever end
    // first, the more the further it is drawn. At the start of a stroke the
    // hand sets it that way at once.
    // The handle is always on the hand's side, though: of the two ways
    // along a stroke it lies the one nearer the way the arm comes in, and it
    // goes over to the other only once that one is `SIDE.over` round from
    // the arm. A hand cannot hold a blade from in front of it.
    _swing(moved, normal, point) {
        if (!this.lie) return;
        const V3 = BABYLON.Vector3, flat = moved.subtract(normal.scale(V3.Dot(moved, normal)));
        let arm = this.arm ? this.arm.slack(point) : this.lie;
        arm = arm.subtract(normal.scale(V3.Dot(arm, normal))).normalize();
        if (this.drawn < SWING.sets && flat.lengthSquared() > 1e-12) {
            this.lie = flat.normalize().scale(V3.Dot(flat, arm) >= 0 ? 1 : -1);
            return;
        }
        const way = V3.Dot(flat, this.lie) >= 0 ? 1 : -1, trail = SWING.trail + this._inFlesh();
        const turned = this.lie.scale(trail).add(flat.scale(way));
        if (turned.lengthSquared() > 1e-12) this.lie = turned.normalize();
        if (V3.Dot(this.lie, arm) < -Math.sin(SIDE.over)) this.lie.scaleInPlace(-1);
    }

    // How fast the point is going, from where it has been over the last moment.
    _speed(point, dt) {
        this.clock = (this.clock || 0) + dt;
        this.trail.push({ at: point, when: this.clock });
        while (this.trail.length > 2 && this.clock - this.trail[0].when > OVER) this.trail.shift();
        let far = 0;
        for (let i = 1; i < this.trail.length; i++) far += BABYLON.Vector3.Distance(this.trail[i].at, this.trail[i - 1].at);
        return far / Math.max(this.clock - this.trail[0].when, 1e-4);
    }

    // The blade inside the body, on a vessel or an organ. `hit` is where its
    // ray came in through the skin's old surface, if it did.
    _within(met, hit, ray, dt) {
        const thing = met.tube || met.organ, deep = hit ? BABYLON.Vector3.Distance(hit.point, met.point) : 0;
        if (!this.on || this.on.thing !== thing) this.on = { thing, travelled: 0, at: met.point };
        // It cuts what it is on once its point has got down to it (or past it: drawn across from somewhere deeper, it is
        // through it already), as far as it is then drawn across it.
        if (this.down && deep - this.sunk < ARRIVED) {
            const went = BABYLON.Vector3.Distance(met.point, this.on.at);
            this.on.travelled += went;
            this.speed = went / Math.max(dt, 1e-3);
            if (met.tube && this.on.travelled > ACROSS && met.tube.sever(met.point)) this.severed++;
            if (met.organ) { met.organ.nick(met.point, met.normal); this.cutting = 'organ'; }
            // And whatever else runs in the fat right under the edge, seen or not: drawn across the hilum of a kidney, a
            // blade parts its artery and vein behind whatever lies in front of them, as far on down its line as it reaches.
            if (this.on.travelled > ACROSS) {
                for (let on = 0; on <= BEHIND; on += REACHES / 3) {
                    const at = met.point.add(ray.direction.scale(on));
                    for (const tube of this.inside.organs.tubes.values()) if (!tube.cut && tube.distance(at) < REACHES && tube.sever(at)) this.severed++;
                }
            }
        } else this.on.travelled = 0;
        this.on.at = met.point;
        this.at = null;
        // It stands the way the body lies where it went in, not the way each fold of what it is on happens to face.
        const lies = hit ? this.field.normal(hit.u, hit.v) : this.field.normal(...this.field.place(met.point.x, met.point.z));
        this._hold(hit ? hit.point : met.point, lies, ray, deep, dt, ray.direction);
    }

    // Put the scalpel in the world: its point on (or over) a surface that
    // faces `normal`, or `deep` metres on from there the way `sinks`, in
    // whatever is open under it; its handle up, its edge down, and the hand
    // that has it round it. Across the surface the point keeps up with the
    // mouse. Into a wound and out of one it goes as a hand does, not at
    // once. Lifted, it is lifted toward the eye and not straight off the
    // skin: the point is always seen exactly where it will come down, which
    // is where it will cut.
    _hold(point, facing, ray, deep, dt, sinks) {
        const V3 = BABYLON.Vector3;
        // What it stands on does not turn under it at a stroke: the hand comes round to it.
        const normal = this.stands = this.stands ? V3.Lerp(this.stands, facing, Math.min(1, dt * STEADY)).normalize() : facing;
        this.sunk += (deep - this.sunk) * Math.min(1, dt * SINKS);
        const wanted = point.add(sinks.scale(this.sunk + (this.down ? 0.002 : 0))).add(ray.direction.scale(this.down ? 0 : -HOVER));
        this.tip = this.tip ? V3.Lerp(this.tip, wanted, Math.min(1, dt * 30)) : wanted;
        this.lie = this._lies(point, normal, dt);
        // Deeper in, the blade stands up in the hand, so that the fingers stay off the skin.
        this.tilt = Math.max(TILT, Math.asin(Math.min(0.97, (this.sunk + CLEAR) / GRIP)));
        const handle = this.lie.scale(Math.cos(this.tilt)).add(normal.scale(Math.sin(this.tilt)));
        const back = normal.subtract(handle.scale(V3.Dot(normal, handle))).normalize();
        BABYLON.Quaternion.RotationQuaternionFromAxisToRef(handle, back, V3.Cross(handle, back), this.mesh.rotationQuaternion);
        this.mesh.position.copyFrom(this.tip);
        if (this.arm) this.arm.reach({ at: this.tip.add(handle.scale(GRIP)), along: handle, back });
    }

    // Which way the handle lies along the surface. While the blade is in,
    // the way it has swung to (`_swing`). Out of the flesh, it goes back to
    // the way the hand holds it: in a hand, the way the arm comes in to it;
    // in no hand, the way it was last drawn.
    _lies(point, normal, dt) {
        const V3 = BABYLON.Vector3, flat = (v) => v.subtract(normal.scale(V3.Dot(v, normal))).normalize();
        if (this.down && this.lie) return flat(this.lie);
        const along = flat(this.arm ? this.arm.slack(point) : this.travel);
        return this.lie ? flat(V3.Lerp(this.lie, along, Math.min(1, dt * SWING.relaxes))) : along;
    }
}
