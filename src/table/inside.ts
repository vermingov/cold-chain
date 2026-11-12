// Inside the body: what a hand or a blade meets once the wall is open, and
// what will and will not come away.
//
// Nothing lifts until it is free. A kidney hangs by its artery, its vein
// and its ureter, and until all three are cut it gives a centimetre or two
// and no more; pull harder and what holds it tears, which is a kidney
// nobody pays full price for. The bowel is another matter: it is on a long
// leash and has only to be laid out of the way.

import * as BABYLON from '@babylonjs/core';
import { WALL } from './field.ts';

// What holds each thing in. `gives` is how far it can be moved while held,
// in metres; `by` names the tubes that hold it, and with all of them cut it
// is free. Anything not listed is part of the body and does not move.
const HELD = {
    'small bowel': { gives: 0.26 },
    // The colon on either side lies on the back wall and is peeled off it toward the middle to get at a kidney; the
    // duodenum and the head of the pancreas fold over to the left off the right kidney the same way (Kocher).
    'ascending colon': { gives: 0.14 },
    duodenum: { gives: 0.07 },
    pancreas: { gives: 0.05 },
    'transverse colon': { gives: 0.12 },
    'descending colon': { gives: 0.14 },
    stomach: { gives: 0.03 },
    liver: { gives: 0.02 },
    spleen: { gives: 0.02 },
    // A kidney in its fat can be drawn a few centimetres on its vessels, the length of them to the great vessels.
    'right kidney': { gives: 0.035, by: ['right renal artery', 'right renal vein', 'right ureter'] },
    'left kidney': { gives: 0.035, by: ['left renal artery', 'left renal vein', 'left ureter'] },
};
// Past what it gives, a held thing still comes, but a third as far as the hand goes: what holds it is taking the
// strain. The hand `TEARS` metres further than that and it tears free.
const STRAIN = 0.3;
const TEARS = 0.07;
const OVER = 0.12;          // how much of a thing's width, each way from its middle, the wall has to be open over for it to come out
const CLEAR = 0.02;         // metres above the skin under it that a free thing is out of the body
// Everything inside is solid (Havok). What is part of the body (the spine, the pelvis, the great vessels, and what
// barely moves: the liver, the spleen, the stomach) is fixed where it is. What moves lies still where it is until a
// hand takes it: then it is a body of its own drawn after the hand, and it knocks against the rest and cannot go
// through it; let go, it drops and comes to rest on what is under it, and lies still there again. (Only what is in a
// hand or coming to rest moves: what it knocks into stays where it is. Pushed in turn, packed soft things sent each
// other flying.)
// How heavy a thing is for its size (kg per cubic metre of its box, which it fills about half of), how it slides
// and lands, and how dead it is in the air (soft, wet tissue does not swing).
const FALLS = { density: 520, friction: 0.9, restitution: 0.04, damping: 0.5 };
const INSIDE = { damping: 6, still: 0.012, settles: 1.4 };       // damping in the body; m/s it is at rest under, seconds at most to come to rest
// The hand draws what it has toward where it wants it this hard (per second of the distance), and no faster (m/s).
const DRAWN = { gain: 18, most: 1.6 };
// The bit the cooler's rim is in, for collisions (Inside._mask; the trolley sets it).
export const RIM = 1;
const BARELY = 0.03;        // what gives no more than this (metres) is as good as fixed
const LEASH = 1.5;          // how far past what it gives a thing on a mesentery can be drawn, of what it gives
const BACK = 6;             // how hard (per second of the distance) a thing let go past its leash is drawn back to it

export class Inside {
    declare field: any;
    declare organs: any;
    declare table: any;
    declare torn: any[];
    declare held: any;
    declare settling: Map<any, number>;
    declare physics: boolean;

    // `table` is how high the table's top is, for things put down on it.
    constructor(field, organs, table) {
        this.field = field;
        this.organs = organs;
        this.table = table;
        this.torn = [];             // the names of things pulled out by force
        this.held = null;           // the organ a hand has, if any
        this.settling = new Map();  // organ -> seconds it has been coming to rest
        // Every organ in the world's frame from here, each with a bit of its own to be told apart in a collision.
        let bit = 1;
        for (const organ of organs.all.values()) {
            organ.frame = organ.mesh.parent;
            organ.mesh.setParent(null);
            organ.home = organ.mesh.position.clone();
            organ.bit = bit = bit << 1;
        }
        this.physics = organs.scene.isPhysicsEnabled();
        if (this.physics) for (const organ of organs.all.values()) this._still(organ);
    }

    // Once a frame: what a hand has is drawn after it, and what was let go comes to rest.
    update(dt) {
        if (!this.physics || dt <= 0) return;
        for (const organ of [this.held, ...this.settling.keys()]) if (organ) organ.shift.copyFrom(organ.mesh.position.subtract(organ.home));
        const organ = this.held;
        if (organ && organ.body && organ.wants) {
            // Toward where the hand wants it (what holds it allowing), as fast as tissue goes; the turn it was given dies away.
            const go = organ.home.add(organ.wants).subtract(organ.mesh.position).scale(DRAWN.gain);
            if (go.length() > DRAWN.most) go.normalize().scaleInPlace(DRAWN.most);
            organ.body.body.setLinearVelocity(go);
            organ.body.body.setAngularVelocity(organ.body.body.getAngularVelocity().scale(0.8));
            this._exclude(organ);
            this._drag(organ);
        }
        for (const [each, spent] of this.settling) {
            // Still on its leash while it drops: past it, it is drawn back to it.
            const held = HELD[each.name], far = each.shift.length(), most = held?.by ? held.gives + TEARS : (held?.gives ?? 0) * LEASH;
            if (held && !this.free(each) && far > most) {
                const back = each.shift.scale(most / far).subtract(each.shift).scale(BACK);
                each.body.body.setLinearVelocity(each.body.body.getLinearVelocity().add(back));
            }
            this._drag(each);
            const still = each.body.body.getLinearVelocity().length() < INSIDE.still;
            if ((still && spent > 0.3) || spent > INSIDE.settles) { this.settling.delete(each); this._still(each); }
            else this.settling.set(each, spent + dt);
        }
    }

    // What a ray from the eye meets inside the body: { organ } or { tube },
    // with `point` and `normal`; or null if the wall is not open where the
    // ray goes in, or there is nothing there.
    meet(ray) {
        const skin = this.field.hit(ray);
        if (skin && !this.field.open(skin.u, skin.v)) return null;
        const met = this.organs.meet(ray);
        // A thing lifted clear of the body can be met anywhere; one still in
        // it only through the opening.
        if (!met || (!skin && !(met.organ && this.free(met.organ)))) return null;
        return met;
    }

    // Whether everything that held it has been cut (or torn).
    free(organ) {
        const held = HELD[organ.name];
        return !!held && !!held.by && held.by.every((name) => this.organs.tubes.get(name).cut);
    }

    // Try to have `organ` moved `to` (a shift from where it lies, in the
    // world). It goes as far as what holds it lets it. Returns the shift it
    // ended up with.
    move(organ, to) {
        const held = HELD[organ.name];
        if (!held) return organ.shift;
        if (!this.free(organ)) {
            const far = to.length();
            if (held.by && far > held.gives + TEARS) this._tear(organ, held);
            else if (far > held.gives) to = to.scale((held.gives + (far - held.gives) * STRAIN) / far);
            // What hangs on its mesentery and not on vessels to be cut comes no further than its leash, however hard it is pulled.
            if (!held.by && to.length() > held.gives * LEASH) to = to.normalize().scale(held.gives * LEASH);
        }
        if (this.physics && organ.body) {
            organ.wants = this._under(organ, to);
            return organ.shift;
        }
        organ.shift.copyFrom(to);
        this._place(organ);
        this._keepUnder(organ);
        this._drag(organ);
        return organ.shift;
    }

    // Whether a hand can move it at all (the spine, the pelvis, the great vessels are the body, and what gives a
    // couple of centimetres at most is as good as part of it).
    movable(organ) { return !!HELD[organ.name] && (HELD[organ.name].gives > BARELY || this.free(organ)); }

    // Whether it is still held by tubes not yet cut (and so cannot be taken out).
    tethered(organ) { return !!HELD[organ.name]?.by && !this.free(organ); }

    // What still holds it: the names of its tubes not yet cut.
    holding(organ) { return (HELD[organ.name]?.by ?? []).filter((name) => !this.organs.tubes.get(name).cut); }

    // Whether it is being pulled further than what holds it gives: the hand feels it.
    strained(organ) { return this.tethered(organ) && organ.shift.length() > HELD[organ.name].gives; }

    // Put a free thing down with its middle at a point of the world (into the cooler, say).
    putAt(organ, point) {
        this._body(organ, null);
        organ.shift.copyFrom(organ.mesh.position.subtract(organ.home));
        organ.mesh.computeWorldMatrix(true);
        organ.shift.addInPlace(point.subtract(organ.mesh.getBoundingInfo().boundingBox.centerWorld));
        this._place(organ);
        this._drag(organ);
    }

    // Whether it has been taken right out: free, and lifted clear of the body (or carried off it).
    out(organ) {
        if (!this.free(organ)) return false;
        organ.mesh.computeWorldMatrix(true);
        const { minimumWorld: low, centerWorld: c } = organ.mesh.getBoundingInfo().boundingBox;
        const [u, v] = this.field.place(c.x, c.z), skin = u > 0 && u < 1 && v > 0 && v < 1 ? this.field.heightAt(u, v) : -Infinity;
        return skin === -Infinity || low.y > skin + CLEAR;
    }

    // What it hangs by goes with it: stretched while whole, its cut ends dangling once cut.
    _drag(organ) {
        const held = HELD[organ.name];
        if (!held.by || organ.loose) return;
        // (The tubes are drawn in the body's own turned frame.)
        const offset = BABYLON.Vector3.TransformNormal(organ.mesh.position.subtract(organ.home), organ.frame.getWorldMatrix().clone().invert());
        for (const name of held.by) this.organs.tubes.get(name).follow(organ, offset);
    }

    // Nothing comes up through the wall. Wherever there is wall over a
    // thing (over its middle, or part of the way out to any side of it), it
    // can be no higher than the underside of that wall: to lift it out, the
    // belly has to be open over all of it.
    _keepUnder(organ) {
        organ.mesh.computeWorldMatrix(true);
        const { minimumWorld: low, maximumWorld: high } = organ.mesh.getBoundingInfo().boundingBox;
        const midX = (low.x + high.x) / 2, midZ = (low.z + high.z) / 2, outX = (high.x - low.x) * OVER, outZ = (high.z - low.z) * OVER;
        let roof = Infinity;
        for (const [x, z] of [[midX, midZ], [midX - outX, midZ], [midX + outX, midZ], [midX, midZ - outZ], [midX, midZ + outZ]]) {
            const [u, v] = this.field.place(x, z), skin = u > 0 && u < 1 && v > 0 && v < 1 ? this.field.heightAt(u, v) : -Infinity;
            if (skin > -Infinity && !this.field.open(u, v)) roof = Math.min(roof, skin - WALL);
        }
        if (high.y <= roof) return;
        organ.shift.y -= high.y - roof;
        this._place(organ);
    }

    // Let go of it. Nothing hangs in the air: a thing let go over the open
    // belly sinks back to the depth it lay at, in among the rest; one let go
    // over skin comes to rest on it; one out of the body and off it falls.
    drop(organ) {
        organ.mesh.computeWorldMatrix(true);
        const { minimumWorld, maximumWorld } = organ.mesh.getBoundingInfo().boundingBox;
        const [u, v] = this.field.place((minimumWorld.x + maximumWorld.x) / 2, (minimumWorld.z + maximumWorld.z) / 2);
        const overBody = u > 0 && u < 1 && v > 0 && v < 1 && this.field.heightAt(u, v) > -Infinity;
        if (this.held === organ) this.held = null;
        organ.wants = null;
        this._mask(organ);
        if (this.physics) {
            // Out of the body and off it, it falls where it falls; in it, it drops onto what is under it and lies there.
            if (!overBody && this.free(organ)) this.fall(organ);
            else {
                this._body(organ, 'moving');
                organ.body.body.setGravityFactor(1);
                this.settling.set(organ, 0);
            }
            return;
        }
        if (overBody && this.field.open(u, v)) organ.shift.y = Math.min(organ.shift.y, 0);
        // (One that never came out from under the wall stays where it is.)
        else if (!(overBody && maximumWorld.y < this.field.heightAt(u, v) - WALL + 0.005)) {
            // A soft thing lies into what is under it a little.
            const rest = (overBody ? this.field.heightAt(u, v) : this.table) - (maximumWorld.y - minimumWorld.y) * 0.18;
            organ.shift.y += rest - minimumWorld.y;
        }
        this._place(organ);
        if (HELD[organ.name]) this._drag(organ);
    }

    // From now on it is a thing of its own in the room: it falls, lands, rolls and knocks into whatever else is there.
    fall(organ) {
        if (this.held === organ) this.held = null;
        organ.wants = null;
        this._mask(organ);
        this.settling.delete(organ);
        if (!organ.loose) for (const name of HELD[organ.name]?.by ?? []) this.organs.tubes.get(name).ride(organ);
        organ.loose = true;
        // A body again, free to turn over now: it is a thing on its own.
        organ.solid = null;
        organ.body?.dispose();
        organ.body = null;
        this._body(organ, 'moving');
        organ.body.body.setLinearDamping(FALLS.damping);
        organ.body.body.setAngularDamping(FALLS.damping);
        organ.body.body.setGravityFactor(1);
    }

    // Taken by a hand: from now it is drawn after the hand (`move` says where to), and knocks against whatever else is
    // there. What it lay against when it was taken it is let pass through until the two are apart: they were
    // pressed together in the body, and pushing them apart all at once would throw it.
    hold(organ) {
        if (!this.physics) return;
        this.held = organ;
        this.settling.delete(organ);
        organ.wants = organ.shift.clone();
        this._loosen(organ);
    }

    // A body of its own that does not fall, let pass through what it lay against.
    _loosen(organ) {
        this._body(organ, 'moving');
        organ.body.body.setGravityFactor(0);
        this._upright(organ);
        organ.passes = 0;
        organ.mesh.computeWorldMatrix(true);
        const mine = organ.mesh.getBoundingInfo().boundingBox;
        for (const other of this.organs.all.values()) {
            if (other === organ) continue;
            other.mesh.computeWorldMatrix(true);
            if (BABYLON.BoundingBox.Intersects(mine, other.mesh.getBoundingInfo().boundingBox)) organ.passes |= other.bit;
        }
        this._mask(organ);
    }

    // It does not turn while it is in a hand or in the body: it is moved by where it is, and its middle is far from
    // the point it is moved by (the body's own), so a turn would swing it away.
    _upright(organ) {
        const body = organ.body.body;
        body.setMassProperties({ mass: body.getMassProperties().mass, inertia: BABYLON.Vector3.Zero() });
        body.setAngularVelocity(BABYLON.Vector3.Zero());
    }

    // What it lay against and has come away from, it knocks against again.
    _exclude(organ) {
        if (!organ.passes) return;
        organ.mesh.computeWorldMatrix(true);
        const mine = organ.mesh.getBoundingInfo().boundingBox;
        let passes = 0;
        for (const other of this.organs.all.values()) {
            if (!(organ.passes & other.bit)) continue;
            other.mesh.computeWorldMatrix(true);
            if (BABYLON.BoundingBox.Intersects(mine, other.mesh.getBoundingInfo().boundingBox)) passes |= other.bit;
        }
        if (passes !== organ.passes) { organ.passes = passes; this._mask(organ); }
    }

    _mask(organ) {
        const shape = organ.body?.shape;
        if (!shape) return;
        shape.filterMembershipMask = organ.bit;
        // (Carried in a hand, it goes over the cooler's rim however low it is held: let go, it lands in the ice.)
        shape.filterCollideMask = ~(organ.passes | organ.bit | (organ === this.held ? RIM : 0));
    }

    // Lying still where it is: fixed, and solid to whatever moves.
    _still(organ) { this._body(organ, 'still'); }

    // Make its physics body what is wanted: 'still' (fixed in place, solid as its own mesh), 'moving' (a body of its
    // own, as its hull), or null for none.
    _body(organ, kind) {
        if (organ.solid === kind) return;
        organ.body?.dispose();
        organ.body = null;
        organ.solid = kind;
        if (!kind) return;
        const scene = organ.mesh.getScene();
        if (kind === 'still') {
            organ.body = new BABYLON.PhysicsAggregate(organ.mesh, BABYLON.PhysicsShapeType.MESH, { mass: 0, friction: FALLS.friction }, scene);
        } else {
            const size = organ.mesh.getBoundingInfo().boundingBox.extendSizeWorld, mass = FALLS.density * 8 * size.x * size.y * size.z;
            organ.body = new BABYLON.PhysicsAggregate(organ.mesh, BABYLON.PhysicsShapeType.CONVEX_HULL, { mass, friction: FALLS.friction, restitution: FALLS.restitution }, scene);
            organ.body.body.setLinearDamping(organ.loose ? FALLS.damping : INSIDE.damping);
            organ.body.body.setAngularDamping(organ.loose ? FALLS.damping : INSIDE.damping);
        }
        organ.passes = 0;
        this._mask(organ);
    }

    // Where the hand may have it: no higher than the wall over it where the wall is not open.
    _under(organ, to) {
        organ.mesh.computeWorldMatrix(true);
        const box = organ.mesh.getBoundingInfo().boundingBox, by = to.subtract(organ.shift);
        const low = box.minimumWorld.add(by), high = box.maximumWorld.add(by);
        const midX = (low.x + high.x) / 2, midZ = (low.z + high.z) / 2, outX = (high.x - low.x) * OVER, outZ = (high.z - low.z) * OVER;
        let roof = Infinity;
        for (const [x, z] of [[midX, midZ], [midX - outX, midZ], [midX + outX, midZ], [midX, midZ - outZ], [midX, midZ + outZ]]) {
            const [u, v] = this.field.place(x, z), skin = u > 0 && u < 1 && v > 0 && v < 1 ? this.field.heightAt(u, v) : -Infinity;
            if (skin > -Infinity && !this.field.open(u, v)) roof = Math.min(roof, skin - WALL);
        }
        return high.y <= roof ? to : to.subtract(new BABYLON.Vector3(0, high.y - roof, 0));
    }

    // The blade has gone through the wall at a point of the skin and on into
    // what is under it: mark that.
    under(point) {
        const met = this.organs.meet(new BABYLON.Ray(point.add(new BABYLON.Vector3(0, 0.01, 0)), new BABYLON.Vector3(0, -1, 0)), 0.25, false);
        if (met) met.organ.nick(met.point, met.normal);
    }

    // Pulled out by force: whatever still held it is torn, not cut.
    _tear(organ, held) {
        for (const name of held.by) {
            const tube = this.organs.tubes.get(name);
            if (!tube.cut) tube.sever(organ.mesh.getBoundingInfo().boundingBox.centerWorld);
        }
        this.torn.push(organ.name);
    }

    // Put the mesh where the organ's shift says (the shift and its home are both in the world).
    _place(organ) {
        organ.mesh.position.copyFrom(organ.home.add(organ.shift));
        organ.mesh.computeWorldMatrix(true);
        if (organ.body) {
            organ.body.body.disablePreStep = false;
            organ.mesh.getScene().onAfterRenderObservable.addOnce(() => { if (organ.body) organ.body.body.disablePreStep = true; });
        }
    }
}
