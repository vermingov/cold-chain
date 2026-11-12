// Both hands: which tool the mouse is, and the mouse itself.
//
// One tool is in use at a time and the number keys change it, until there
// is a tray to pick them up from. Each tool is told where the mouse points
// and whether its button is down; what that means is the tool's business.
//
// The first click takes the mouse: from then on it cannot leave the
// picture, and where it points is kept here, moved by how far the mouse is
// moved and held to the edges of the picture. Escape gives it back. The
// wheel raises and lowers whatever the tool in use has hold of, if it can.

export class Hands {
    // `tools` is { name: tool } in the order of the number keys; each tool
    // has aim(x, y), press(down) and update(dt), and may have show(shown).
    constructor(canvas, tools) {
        this.canvas = canvas;
        this.tools = tools;
        this.using = Object.keys(tools)[0];
        this.at = [0, 0];               // where the mouse points on the picture, in its own pixels
        const taken = () => document.pointerLockElement === canvas;
        const aim = (x, y) => {
            this.at = [Math.max(0, Math.min(canvas.clientWidth - 1, x)), Math.max(0, Math.min(canvas.clientHeight - 1, y))];
            this.tool.aim(...this.at);
        };
        const move = (e) => (taken() ? aim(this.at[0] + e.movementX, this.at[1] + e.movementY) : aim(e.offsetX, e.offsetY));
        const down = (e) => {
            if (!taken()) {
                aim(e.offsetX, e.offsetY);
                // (Not every browser hands back a promise, and one that is refused is no harm: the mouse is only not held.)
                const asked = canvas.requestPointerLock && canvas.requestPointerLock();
                if (asked && asked.catch) asked.catch(() => {});
            }
            this.tool.press(true);
        };
        const up = () => this.tool.press(false);
        const wheel = (e) => {
            if (!this.tool.raise) return;
            e.preventDefault();
            // (A notch of the wheel is a hundred of its own measure; rolled away from you is up.)
            this.tool.raise(-Math.sign(e.deltaY) * Math.min(3, Math.abs(e.deltaY) / 100));
        };
        const key = (e) => {
            const name = Object.keys(tools)[+e.code.replace('Digit', '') - 1];
            if (e.code.startsWith('Digit') && name) this.take(name);
        };
        const on = [[canvas, 'pointermove', move], [canvas, 'pointerdown', down], [window, 'pointerup', up], [canvas, 'wheel', wheel, { passive: false }],
            [window, 'keydown', key]];
        for (const [target, name, handler, options] of on) target.addEventListener(name, handler, options);
        this.dispose = () => {
            for (const [target, name, handler] of on) target.removeEventListener(name, handler);
        };
        this.take(this.using);
    }

    get tool() { return this.tools[this.using]; }

    take(name) {
        this.tool.press(false);
        this.using = name;
        for (const [other, tool] of Object.entries(this.tools)) if (tool.show) tool.show(other === name);
        // The knife is its own pointer; a bare hand needs one.
        this.canvas.style.cursor = this.tool.show ? 'none' : 'grab';
    }

    update(dt) { this.tool.update(dt); }
}
