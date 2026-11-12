// The tool being worked with: the spade or the bar.
//
// It is put where it would be, in the world, between the hands and what it
// is working: the spade's blade in the clay at the near side of the hole
// and its handle up at the hands, the bar's end under the lid's edge. A
// stroke moves those two ends through a few places in turn (in, levered
// back, lifted and thrown; or under, heaved), and the tool lies along the
// line between them, its blade turned to whoever holds it. Between strokes
// it is put away.

const V3 = BABYLON.Vector3;
// Each tool: the model, and its stroke as [when (0 to 1), where its working end is, where the hands are]. Places
// are offsets in a frame of the work: `in` is down into what is worked, `back` toward the worker, `aside` toward
// where the spoil is thrown; and from the hands' rest.
const TOOLS = {
    spade: {
        model: 'rusted_spade_01',
        stroke: [
            [0, { in: -0.12, back: 0 }, { in: 0, back: 0 }],
            [0.3, { in: 0.22, back: 0 }, { in: 0.12, back: -0.08 }],
            [0.45, { in: 0.24, back: 0 }, { in: 0.14, back: -0.08 }],
            [0.62, { in: 0.16, back: 0.12 }, { in: 0.1, back: 0.22 }],
            [0.82, { in: -0.45, back: 0.25, aside: 0.55 }, { in: -0.05, back: 0.1, aside: 0.25 }],
            [1, { in: -0.12, back: 0 }, { in: 0, back: 0 }],
        ],
    },
    bar: {
        model: 'crowbar_01',
        stroke: [
            [0, { in: -0.1, back: 0 }, { in: 0, back: 0 }],
            [0.35, { in: 0.03, back: -0.04 }, { in: 0.02, back: -0.15 }],
            [0.7, { in: 0.0, back: 0.02 }, { in: 0.35, back: 0.05 }],
            [1, { in: -0.1, back: 0 }, { in: 0, back: 0 }],
        ],
    },
};

export class Held {
    constructor(models) {
        this.tools = {};
        for (const [name, tool] of Object.entries(TOOLS)) {
            const mesh = models.make(tool.model);
            mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
            mesh.setEnabled(false);
            this.tools[name] = mesh;
        }
        this.showing = null;
    }

    // Take `name` up, or put whatever is held away (null).
    show(name) {
        if (this.showing === name) return;
        for (const [other, mesh] of Object.entries(this.tools)) mesh.setEnabled(other === name);
        this.showing = name;
    }

    // So far through a stroke (0 to 1), working at `work` with the hands at `hands`, the spoil going toward `aside`
    // (a unit, along the ground). All in the world.
    stroke(t, { work, hands, aside }) {
        const stroke = TOOLS[this.showing].stroke;
        let i = 1;
        while (i < stroke.length - 1 && stroke[i][0] < t) i++;
        const [t0, end0, grip0] = stroke[i - 1], [t1, end1, grip1] = stroke[i];
        const k = smooth(Math.max(0, Math.min(1, (t - t0) / (t1 - t0))));
        const back = hands.subtract(work);
        back.y = 0;
        back.normalize();
        const place = (from, a, b) => {
            const at = (key) => (a[key] || 0) * (1 - k) + (b[key] || 0) * k;
            return from.add(new V3(0, -at('in'), 0)).add(back.scale(at('back'))).add(aside.scale(at('aside')));
        };
        const end = place(work, end0, end1), grip = place(hands, grip0, grip1);
        // Lying from its end up to the hands, the flat of it facing the hands.
        const up = grip.subtract(end).normalize();
        const facing = back.subtract(up.scale(V3.Dot(back, up))).normalize();
        const right = V3.Cross(up, facing).normalize();
        const mesh = this.tools[this.showing];
        BABYLON.Quaternion.RotationQuaternionFromAxisToRef(right, up, facing, mesh.rotationQuaternion);
        mesh.position.copyFrom(end);
    }
}

const smooth = (t) => t * t * (3 - 2 * t);
