// Inside the body: what a hand or a blade meets once the wall is open, and
// what will and will not come away.
//
// Nothing lifts until it is free. A kidney hangs by its artery, its vein
// and its ureter, and until all three are cut it gives a centimetre or two
// and no more; pull harder and what holds it tears, which is a kidney
// nobody pays full price for. The bowel is another matter: it is on a long
// leash and has only to be laid out of the way.

import { WALL } from './field.js';

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

export class Inside {
    // `table` is how high the table's top is, for things put down on it.
    constructor(field, organs, table) {
        this.field = field;
        this.organs = organs;
        this.table = table;
        this.torn = [];             // the names of things pulled out by force
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
        }
        organ.shift.copyFrom(to);
        this._place(organ);
        this._keepUnder(organ);
        this._drag(organ);
        return organ.shift;
    }

    // Whether it is still held by tubes not yet cut (and so cannot be taken out).
    tethered(organ) { return !!HELD[organ.name]?.by && !this.free(organ); }

    // Whether it is being pulled further than what holds it gives: the hand feels it.
    strained(organ) { return this.tethered(organ) && organ.shift.length() > HELD[organ.name].gives; }

    // Put a free thing down with its middle at a point of the world (into the cooler, say).
    putAt(organ, point) {
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
        if (!held.by) return;
        const offset = organ.mesh.position.subtract(organ.home);
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
    // over skin or over the table comes to rest on it.
    drop(organ) {
        organ.mesh.computeWorldMatrix(true);
        const { minimumWorld, maximumWorld } = organ.mesh.getBoundingInfo().boundingBox;
        const [u, v] = this.field.place((minimumWorld.x + maximumWorld.x) / 2, (minimumWorld.z + maximumWorld.z) / 2);
        const overBody = u > 0 && u < 1 && v > 0 && v < 1 && this.field.heightAt(u, v) > -Infinity;
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

    // Put the mesh where the organ's shift says: the shift is in the world
    // and the mesh hangs in the body's own turned frame.
    _place(organ) {
        const turned = organ.mesh.parent.getWorldMatrix().clone().invert();
        organ.mesh.position.copyFrom(organ.home.add(BABYLON.Vector3.TransformNormal(organ.shift, turned)));
    }
}
