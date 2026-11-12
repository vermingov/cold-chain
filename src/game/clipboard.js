// The clipboard: the only thing in the game that says what to do.
//
// A board with a pad of lined paper on it, held up in front of the eye on
// Tab and let down again. What is on the pad is written in pencil: the
// order as it was taken down over the phone, the work in the order it is
// done, ticked off as it is, and the money.
//
// It is drawn after everything else, so it never goes into a wall, and it
// lights itself a little: the torch or the lamp is assumed to be on it.

const V3 = BABYLON.Vector3;
const PAGE = { width: 900, height: 1240 };
const BOARD = { width: 0.235, height: 0.33 };
// Where it is held, against the eye: up and read, or down out of sight.
const HELD = { up: new V3(0, 0.035, 0.4), down: new V3(0.02, -0.5, 0.4), tilt: 0.12, eases: 7 };
const INK = '#2c2d33';
const PAPER = '#e7e1d1';
const RULE = 'rgba(70, 110, 160, 0.28)';
const MARGIN = 'rgba(170, 60, 60, 0.4)';

export class Clipboard {
    // `bright` is how lit it is where it is read, against its own paper: a lamp-lit room near 1, a torch less.
    constructor(scene, camera, { bright = 0.8 } = {}) {
        this.root = new BABYLON.TransformNode('clipboard', scene);
        this.root.parent = camera;
        this.root.position.copyFrom(HELD.down);
        this.root.rotation.x = HELD.tilt;
        this.up = false;
        this.page = new BABYLON.DynamicTexture('page', PAGE, scene, true);
        this.page.anisotropicFilteringLevel = 8;

        const board = BABYLON.MeshBuilder.CreateBox('board', { width: BOARD.width, height: BOARD.height, depth: 0.005 }, scene);
        board.material = flat(scene, 'board', new BABYLON.Color3(0.24, 0.17, 0.11).scale(bright));
        board.position.z = 0.003;
        const paper = BABYLON.MeshBuilder.CreatePlane('paper', { width: BOARD.width - 0.02, height: (BOARD.width - 0.02) * PAGE.height / PAGE.width }, scene);
        paper.material = flat(scene, 'paper', BABYLON.Color3.Black());
        paper.material.emissiveTexture = this.page;
        this.page.level = bright;
        paper.position.y = -0.008;
        const clip = BABYLON.MeshBuilder.CreateBox('clip', { width: 0.09, height: 0.028, depth: 0.012 }, scene);
        clip.material = flat(scene, 'clip', new BABYLON.Color3(0.5, 0.5, 0.52).scale(bright));
        clip.position.set(0, BOARD.height / 2 - 0.016, -0.004);
        this.meshes = [board, paper, clip];
        for (const mesh of this.meshes) {
            mesh.parent = this.root;
            mesh.renderingGroupId = 1;
            mesh.isPickable = false;
        }
        this.root.setEnabled(false);
    }

    toggle() { this.show(!this.up); }

    show(up) {
        this.up = up;
        if (up) this.root.setEnabled(true);
    }

    update(dt) {
        const to = this.up ? HELD.up : HELD.down, ease = Math.min(1, dt * HELD.eases);
        this.root.position.addInPlace(to.subtract(this.root.position).scale(ease));
        if (!this.up && V3.Distance(this.root.position, HELD.down) < 0.01) this.root.setEnabled(false);
    }

    // Write the pad out again: `sheet` is { head, order: [lines], steps: [{ says, done }], foot: [lines] }.
    write({ head, order, steps, foot }) {
        const ctx = this.page.getContext(), { width, height } = PAGE;
        ctx.fillStyle = PAPER;
        ctx.fillRect(0, 0, width, height);
        ctx.strokeStyle = RULE;
        ctx.lineWidth = 2;
        for (let y = 150; y < height; y += LINE) rule(ctx, 0, y, width, y);
        ctx.strokeStyle = MARGIN;
        rule(ctx, 96, 0, 96, height);

        ctx.fillStyle = INK;
        ctx.strokeStyle = INK;
        ctx.textBaseline = 'alphabetic';
        ctx.font = 'italic 52px Fell';
        ctx.fillText(head, 112, 128);
        let y = 150 + LINE - 12;
        ctx.font = 'italic 38px Fell';
        for (const line of order) y = wrap(ctx, line, 112, y, width - 150);
        y += LINE;
        for (const step of steps) {
            box(ctx, 64, y - 27, step.done);
            const end = wrap(ctx, step.says, 112, y, width - 150);
            if (step.done) strike(ctx, step.says, 112, y);
            y = end;
        }
        y = Math.max(y + LINE, height - LINE * foot.length - 40);
        for (const line of foot) y = wrap(ctx, line, 112, y, width - 150);
        this.page.update(true);
    }

    dispose() { this.root.dispose(false, true); }
}

const LINE = 54;            // pixels from one rule of the pad to the next

function flat(scene, name, colour) {
    const m = new BABYLON.StandardMaterial(name, scene);
    m.disableLighting = true;
    m.diffuseColor = BABYLON.Color3.Black();
    m.emissiveColor = colour;
    m.specularColor = BABYLON.Color3.Black();
    m.backFaceCulling = false;
    m.fogEnabled = false;
    return m;
}

function rule(ctx, x0, y0, x1, y1) {
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.stroke();
}

// Words written along the rules, onto as many as they need. Returns where the next line goes.
function wrap(ctx, words, x, y, room) {
    let line = '';
    for (const word of words.split(' ')) {
        const tried = line ? line + ' ' + word : word;
        if (line && ctx.measureText(tried).width > room) {
            ctx.fillText(line, x, y);
            y += LINE;
            line = word;
        } else line = tried;
    }
    ctx.fillText(line, x, y);
    return y + LINE;
}

// A box drawn by hand in the margin, ticked if done.
function box(ctx, x, y, ticked) {
    ctx.lineWidth = 3;
    ctx.strokeRect(x, y, 24, 24);
    if (!ticked) return;
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(x + 2, y + 12);
    ctx.lineTo(x + 10, y + 24);
    ctx.lineTo(x + 30, y - 8);
    ctx.stroke();
}

// Done work is crossed through, once, as people do.
function strike(ctx, words, x, y) {
    ctx.lineWidth = 2.5;
    rule(ctx, x - 4, y - 13, x + Math.min(ctx.measureText(words).width, PAGE.width - 150) + 4, y - 15);
}
