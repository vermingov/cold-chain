// The other hand: the one without the knife in it.
//
// It takes hold of what the mouse is on and moves it with the mouse: the
// bowel, to lay it out of the way; a kidney, to lift it out once it is free.
// Put on skin, it has the skin, and on the lip of a wound that goes through
// the wall it has the wall: drawn away, it pulls the wound open.
//
// It is seen: a gloved hand (arm.js) held open over whatever the mouse is
// on, that pinches when it takes hold and is wherever what it has is.
//
// A piece it has hold of that nothing holds any more (cut right round, or
// peeled free) comes away in it (field.lift), and is a thing (piece.js):
// carried wherever the hand goes, let fall where the hand opens, and taken
// up again from wherever it lies.

const HOVER = 0.012;            // metres the fingertips are held off the skin while the hand is open
// What the hand carries goes up or down `notch` metres for each notch of the wheel, between `lowest` and `highest` of where it was taken.
const RAISE = { notch: 0.015, lowest: -0.08, highest: 0.45 };
const ANGLE = 0.75;             // radians the fingers point down at what they are over

export class Hand {
    // `takes(organ)`, if given, is asked first when the hand opens on something taken out: true if it was taken (into
    // a cooler, say) and is not to be let fall.
    constructor(scene, camera, field, inside, { arm = null, pieces = null, takes = null } = {}) {
        this.scene = scene;
        this.camera = camera;
        this.field = field;
        this.inside = inside;
        this.arm = arm;
        this.pieces = pieces;
        this.takes = takes;
        this.pointer = null;
        this.down = false;
        this.held = null;           // { organ, plane, from, shift, at }, { piece, plane, from, start, at } or { skin: [u, v] where it was taken }
        this.shown = true;
    }

    show(shown) {
        this.shown = shown;
        if (this.arm && !shown) this.arm.reach(null);
    }

    aim(x, y) { this.pointer = [x, y]; }

    // Raise what is in the hand, or lower it, by so many notches of the wheel.
    raise(notches) {
        if (!this.held || !(this.held.piece || this.held.organ)) return;
        this.held.up = Math.max(RAISE.lowest, Math.min(RAISE.highest, (this.held.up || 0) + notches * RAISE.notch));
    }

    press(down) {
        if (down && !this.down) this._take();
        if (!down && this.held && this.held.organ && !(this.takes && this.takes(this.held.organ))) this.inside.drop(this.held.organ);
        if (!down && this.held && this.held.skin) this.field.letGo();
        if (!down && this.held && this.held.piece) this.held.piece.drop();
        if (!down) this.held = null;
        this.down = down;
    }

    _ray() { return this.scene.createPickingRay(this.pointer[0], this.pointer[1], null, this.camera); }

    _take() {
        if (!this.pointer) return;
        const ray = this._ray(), got = this.pieces && this.pieces.pick(ray);
        if (got) {
            this._carry(got.piece, got.point);
            return;
        }
        const met = this.inside.meet(ray);
        if (met && met.organ) {
            // It is moved level, at the height it was taken hold of, under the hand: the wheel lifts and lowers it.
            const plane = BABYLON.Plane.FromPositionAndNormal(met.point, BABYLON.Vector3.Up());
            this.held = { organ: met.organ, plane, from: met.point, shift: met.organ.shift.clone() };
            return;
        }
        const skin = this.field.hit(ray);
        if (skin && this.field.grab(skin.u, skin.v)) this.held = { skin: [skin.u, skin.v] };
    }

    // Carry a piece, taken hold of at `point`: it is moved in the plane that faces the eye, through there.
    _carry(piece, point) {
        const plane = BABYLON.Plane.FromPositionAndNormal(point, this.camera.getForwardRay(1).direction.scale(-1));
        this.held = { piece, plane, from: point, start: piece.position.clone(), at: point };
    }

    update(dt) {
        if (!this.pointer) return;
        const ray = this._ray();
        if (this.held && this.held.piece) {
            const far = ray.intersectsPlane(this.held.plane);
            if (far !== null) {
                const { piece, from, start } = this.held, at = ray.origin.add(ray.direction.scale(far)), to = start.add(at.subtract(from));
                to.y += this.held.up || 0;
                // (Not down through what it is over.)
                to.y = Math.max(to.y, this.pieces.ground(to.x, to.z) - piece.low + 0.003);
                piece.carry(to, dt);
                this.held.at = to.add(from.subtract(start));
            }
        } else if (this.held && this.held.organ) {
            const far = ray.intersectsPlane(this.held.plane);
            if (far !== null) {
                this.held.at = ray.origin.add(ray.direction.scale(far));
                this.held.at.y += this.held.up || 0;
                this.inside.move(this.held.organ, this.held.shift.add(this.held.at.subtract(this.held.from)));
            }
        } else if (this.held) {
            const skin = this.field.hit(ray);
            if (skin) this.field.drag(skin.u - this.held.skin[0], skin.v - this.held.skin[1]);
            // What it has may have come free of the body.
            const shape = this.pieces && this.field.held() && this.field.lift();
            if (shape) {
                const piece = this.pieces.add(shape);
                this._carry(piece, skin ? skin.point : piece.position);
            }
        }
        this._show(ray);
    }

    // Put the hand where it is: on what it has, or open over what the mouse is on.
    _show(ray) {
        if (!this.arm || !this.shown) return;
        let at, on;
        const over = !this.held && this.pieces && this.pieces.pick(ray);
        if (this.held && (this.held.organ || this.held.piece)) at = this.held.at || this.held.from;
        else if (over) at = over.point;
        else if (this.held && this.field.held()) { on = this.field.held(); at = this.field.point(...on); }
        else {
            const skin = this.field.hit(ray);
            if (!skin) { this.arm.reach(null); return; }
            on = [skin.u, skin.v];
            at = skin.point;
        }
        const V3 = BABYLON.Vector3, normal = on ? this.field.normal(...on) : V3.Up();
        if (!this.held) at = at.add(normal.scale(HOVER));
        this.arm.hold(this.held ? 'pinch' : 'open');
        // The fingers point in at it from the way the arm comes, tipped down onto it.
        const slack = this.arm.slack(at), flat = slack.subtract(normal.scale(V3.Dot(slack, normal))).normalize();
        const along = flat.scale(Math.cos(ANGLE)).add(normal.scale(Math.sin(ANGLE)));
        const back = normal.subtract(along.scale(V3.Dot(normal, along))).normalize();
        this.arm.reach({ at, along, back });
    }
}
