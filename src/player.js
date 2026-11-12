// The player: feet, eyes, and the small dishonesties of a camera on a neck.
//
// Walking is slow on purpose. This is somebody crossing a cemetery at night
// with a torch, trying not to be heard, and a place a hundred metres long
// stops being frightening at a jog. They can run, for a while; they can get
// down on their heels to read a marker or look into a hole.
//
// The player knows nothing about any particular place: it is handed the
// ground's height, what is solid, how far it may go and what is underfoot,
// and says when a foot comes down and on what.

const LOOK_RATE = 0.0021;   // radians per pixel of mouse travel at a look speed of 1
const NOTHING = new Set();  // the keys of somebody who is held still

const BODY = {
    radius: 0.3,
    eye: 1.65, crouched: 0.92,      // metres from the ground to the eye
    walk: 1.55, run: 3.4, creep: 0.85,
    accel: 9, friction: 11,
    stride: 0.74,                   // metres between footfalls
    drain: 0.14, recover: 0.09,     // of a full breath, a second
};

export class Player {
    // `place` is { ground(x, z), solids, limits: { x0, z0, x1, z1 }, underfoot(x, z) }.
    constructor(scene, canvas, place) {
        this.canvas = canvas;
        this.place = place;

        this.camera = new BABYLON.FreeCamera('eye', new BABYLON.Vector3(0, BODY.eye, 0), scene);
        this.camera.minZ = 0.06;
        this.camera.maxZ = 400;
        // Fixed across rather than top to bottom, so a wider screen sees more
        // above and below, not a wider and wider fisheye.
        this.camera.fovMode = BABYLON.Camera.FOVMODE_HORIZONTAL_FIXED;
        this.camera.fov = 1.5;
        this.camera.inputs.clear();          // all look and move handled here
        scene.activeCamera = this.camera;

        this.pos = { x: 0, z: 0 };
        this.vel = { x: 0, z: 0 };
        this.yaw = 0;
        this.pitch = 0;
        this.lookSpeed = 1;
        this.stand = BODY.eye;      // how tall this player's eye is, standing
        this.crouch = 0;            // 0 standing to 1 on their heels
        this.breathLeft = 1;
        this.running = false;
        this.height = 0;            // of the ground under the feet, eased
        this.travelled = 0;         // since the last footfall
        this.steps = 0;
        this.bobPhase = 0;
        this.breathing = 0;
        this.onStep = null;         // called with (what is underfoot, how hard) on every footfall
        this.held = false;          // kept where they are: neither walking nor looking about
        this.slowed = 1;            // of the usual pace, for somebody pushing something heavy

        this.keys = new Set();
        this._bindInput();
    }

    _bindInput() {
        const keydown = (e) => {
            this.keys.add(e.code);
            if (e.code === 'Space' || e.code === 'Tab') e.preventDefault();
        };
        const keyup = (e) => this.keys.delete(e.code);
        const blur = () => this.keys.clear();
        const click = () => this.canvas.requestPointerLock();
        const look = (e) => {
            if (document.pointerLockElement !== this.canvas || this.held) return;
            this.yaw += e.movementX * LOOK_RATE * this.lookSpeed;
            const limit = Math.PI * 0.46;
            this.pitch = Math.max(-limit, Math.min(limit, this.pitch + e.movementY * LOOK_RATE * this.lookSpeed));
        };
        const on = [[window, 'keydown', keydown], [window, 'keyup', keyup], [window, 'blur', blur], [this.canvas, 'click', click], [this.canvas, 'mousemove', look]];
        for (const [target, name, handler] of on) target.addEventListener(name, handler);
        this.dispose = () => {
            for (const [target, name, handler] of on) target.removeEventListener(name, handler);
            this.camera.dispose();
        };
    }

    // Stand at (x, z). `toward` is a point [x, y, z] to be looking at, and
    // `eye` a standing eye height other than the usual.
    spawn(x, z, { toward = null, eye = BODY.eye } = {}) {
        this.pos.x = x; this.pos.z = z;
        this.vel.x = this.vel.z = 0;
        this.stand = eye;
        this.crouch = 0;
        this.height = this.place.ground(x, z);
        if (toward) {
            const dx = toward[0] - x, dy = toward[1] - (this.height + eye), dz = toward[2] - z;
            this.yaw = Math.atan2(dx, dz);
            this.pitch = -Math.atan2(dy, Math.hypot(dx, dz));
        }
        this._see(0);
    }

    get speed() { return Math.hypot(this.vel.x, this.vel.z); }

    update(dt) {
        const k = this.held ? NOTHING : this.keys;
        const ahead = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0);
        const across = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0);
        const moving = ahead !== 0 || across !== 0;

        const down = k.has('ControlLeft') || k.has('KeyC');
        this.crouch += ((down ? 1 : 0) - this.crouch) * Math.min(1, dt * 7);
        // Nobody runs on their heels, or with no breath left.
        this.running = moving && this.crouch < 0.3 && (k.has('ShiftLeft') || k.has('ShiftRight')) && this.breathLeft > 0.04;
        this.breathLeft = Math.max(0, Math.min(1, this.breathLeft + (this.running ? -BODY.drain : BODY.recover) * dt));

        const upright = this.running ? BODY.run : BODY.walk;
        const pace = (upright + (BODY.creep - upright) * this.crouch) * this.slowed;
        const sin = Math.sin(this.yaw), cos = Math.cos(this.yaw);
        let wishX = sin * ahead + cos * across, wishZ = cos * ahead - sin * across;
        const length = Math.hypot(wishX, wishZ) || 1;
        wishX *= pace / length; wishZ *= pace / length;
        const grip = Math.min(1, dt * (moving ? BODY.accel : BODY.friction));
        this.vel.x += (wishX - this.vel.x) * grip;
        this.vel.z += (wishZ - this.vel.z) * grip;

        const before = { x: this.pos.x, z: this.pos.z };
        this.pos.x += this.vel.x * dt;
        this.pos.z += this.vel.z * dt;
        const pushed = this.place.solids.push(this.pos, BODY.radius);
        if (pushed) {
            // Lose the speed that was into the thing and keep what was along it.
            const into = this.vel.x * pushed[0] + this.vel.z * pushed[1];
            if (into < 0) { this.vel.x -= pushed[0] * into; this.vel.z -= pushed[1] * into; }
        }
        const { x0, z0, x1, z1 } = this.place.limits;
        this.pos.x = Math.max(x0, Math.min(x1, this.pos.x));
        this.pos.z = Math.max(z0, Math.min(z1, this.pos.z));

        const went = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
        this.travelled += went;
        this.bobPhase += went * (Math.PI / BODY.stride);
        const stride = BODY.stride * (this.running ? 1.25 : 1) * (1 - this.crouch * 0.4);
        if (this.travelled > stride) {
            this.travelled -= stride;
            this.steps++;
            if (this.onStep) this.onStep(this.place.underfoot(this.pos.x, this.pos.z), this.running ? 1 : 0.55 - this.crouch * 0.3);
        }
        this._see(dt);
    }

    _see(dt) {
        // The ground under the feet, eased: a head does not follow every dip.
        const ground = this.place.ground(this.pos.x, this.pos.z);
        this.height += (ground - this.height) * (dt ? Math.min(1, dt * 12) : 1);
        this.breathing += dt * (this.running ? 2.6 : 1.1 + (1 - this.breathLeft) * 2);

        const going = Math.min(1, this.speed / BODY.walk);
        const bob = Math.abs(Math.sin(this.bobPhase)) * 0.034 * (this.running ? 1.6 : 1) * going;
        const sway = Math.sin(this.bobPhase) * 0.014 * going;
        const breath = Math.sin(this.breathing) * (0.006 + (1 - this.breathLeft) * 0.012);
        const eye = this.stand + (BODY.crouched - this.stand) * this.crouch;
        this.camera.position.set(this.pos.x + sway * Math.cos(this.yaw), this.height + eye - bob + breath, this.pos.z - sway * Math.sin(this.yaw));
        this.camera.rotation.set(this.pitch, this.yaw, Math.sin(this.bobPhase) * 0.006 * going);
    }
}
