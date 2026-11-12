// What can be done with what is in front of the eye.
//
// A place puts its usable things here: where each is, how near it has to be
// and what is done with it. Whichever is nearest the middle of the eye, in
// reach, and has something to be done with it just now is the one E does it
// to, and its verb is shown under the middle of the picture.

import * as BABYLON from '@babylonjs/core';
const V3 = BABYLON.Vector3;
const AIM = 0.16;           // metres to either side of the line of sight a thing may be, at a metre off, and still be looked at

export class Things {
    declare camera: any;
    declare screen: any;
    declare all: any[];
    declare looked: any;
    declare busy: boolean;
    declare paused: boolean;
    declare otherwise: any;
    declare _use: (e: any) => void;

    constructor(camera, screen) {
        this.camera = camera;
        this.screen = screen;
        this.all = [];
        this.looked = null;
        this.busy = false;          // while something is being done, nothing else is offered
        this.paused = false;        // while the place is not being played
        this.otherwise = null;      // what E does when nothing else is looked at, if it has a verb: letting go of what is held
        this._use = (e) => {
            if (e.code === 'KeyE' && this.looked && !this.busy && !this.paused) this.do(this.looked);
        };
        window.addEventListener('keydown', this._use);
    }

    // `thing` is { at: Vector3 or () => Vector3, reach (metres, 2 if not said), wide (how much more than most it may be
    // off the line of sight), verb: () => words or null, use: () => (a promise, if it takes time) }.
    add(thing) {
        this.all.push(thing);
        return thing;
    }

    remove(thing) { this.all = this.all.filter((t) => t !== thing); }

    async do(thing) {
        this.busy = true;
        this.screen.hint(null);
        try {
            await thing.use();
        } finally {
            this.busy = false;
        }
    }

    update() {
        const eye = this.camera.globalPosition, ahead = this.camera.getDirection(V3.Forward());
        let best = null, nearest = Infinity;
        for (const thing of this.all) {
            const at = typeof thing.at === 'function' ? thing.at() : thing.at;
            const to = at.subtract(eye), along = V3.Dot(to, ahead);
            if (along <= 0.05 || to.length() > (thing.reach ?? 2)) continue;
            const off = Math.sqrt(Math.max(0, to.lengthSquared() - along * along)) / Math.max(along, 0.4);
            if (off > AIM * (thing.wide || 1) || off >= nearest || !thing.verb()) continue;
            best = thing;
            nearest = off;
        }
        if (!best && this.otherwise && this.otherwise.verb()) best = this.otherwise;
        this.looked = this.busy ? null : best;
        this.screen.hint(this.looked && this.looked.verb());
    }

    dispose() { window.removeEventListener('keydown', this._use); }
}
