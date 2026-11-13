// What is in the player's hands, and what it does.
//
// The guns fire real loads, measured: a 9 mm round leaves at 360 m/s with
// about 480 J, a 7.62 rifle round at 820 m/s with 2.7 kJ, a 12 bore shell
// throws nine 00 buckshot pellets of 3.5 g each. What happens to a body is
// wounds.ts's business; here a shot is a line that is followed through
// people and on until it is spent or meets a wall. Blades are a stab (a short
// line from the eye) or a cut (a fan of short lines swept across), and a bat
// is a swing that lands a blow on the first person it meets.

import * as BABYLON from '@babylonjs/core';
import { place } from '../glb.ts';
import { pierce, blow, type Missile } from './wounds.ts';
import { rayToSegment } from './anatomy.ts';
import { blast } from './dismember.ts';
import * as viscera from './viscera.ts';
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion;
const FRAGMENTS = 1000;      // an M67's body breaks into roughly this many that can wound

type Gun = Missile & { rounds: number; every: number; pellets: number; spread: number; kick: number; sound: string; reload: number; speed: number; auto?: boolean };

// Where each thing sits in the hand, in the eye's own frame (x right, y up, z ahead), and how it is turned there.
const HELD = {
    knife: { at: [0.24, -0.25, 0.42], turn: [-0.25, -0.1, 0.15] },
    sword: { at: [0.3, -0.33, 0.45], turn: [-0.9, -0.15, 0.25] },
    bat: { at: [0.3, -0.38, 0.32], turn: [-1.2, -0.2, 0.4] },
    pistol: { at: [0.16, -0.17, 0.4], turn: [0, 0, 0] },
    rifle: { at: [0.16, -0.19, 0.3], turn: [0, 0, 0] },
    shotgun: { at: [0.16, -0.2, 0.3], turn: [0, 0, 0] },
    ak: { at: [0.17, -0.2, 0.5], turn: [0, 0, 0] },
    m4: { at: [0.16, -0.19, 0.42], turn: [0, 0, 0] },
    grenade: { at: [0.2, -0.2, 0.46], turn: [0, 0, 0] },
};

export const ARMS = [
    { key: 'knife', name: 'Knife', kind: 'blade', reach: 1.0, swing: 0.32,
        stab: { energy: 70, mass: 0.2, calibre: 0.02, channel: 0.006, soft: 1.4, hard: 40, reach: 0.17, blade: true } as Missile, cut: 0.022 },
    { key: 'sword', name: 'Sword', kind: 'blade', reach: 1.65, swing: 0.5,
        stab: { energy: 150, mass: 1.2, calibre: 0.03, channel: 0.01, soft: 1.2, hard: 40, reach: 0.75, blade: true } as Missile, cut: 0.055 },
    { key: 'bat', name: 'Baseball bat', kind: 'blunt', reach: 1.25, swing: 0.55, mass: 0.79, speed: 15.5 },  // a man's full swing at head height: about 110 J (dev/research/blunt-trauma.md)
    { key: 'pistol', name: 'Pistol', kind: 'gun', gun: { energy: 480, mass: 0.008, speed: 360, calibre: 0.009, channel: 0.006, soft: 12, hard: 110, rounds: 15, every: 0.13,
        pellets: 1, spread: 0.004, kick: 0.035, sound: 'shot-pistol', reload: 1.6 } as Gun },
    { key: 'rifle', name: 'Rifle', kind: 'gun', gun: { energy: 2700, mass: 0.0097, speed: 820, calibre: 0.0078, channel: 0.012, soft: 28, hard: 160, rounds: 5, every: 1.1,
        pellets: 1, spread: 0.0012, kick: 0.07, sound: 'shot-rifle', reload: 2.6 } as Gun },
    { key: 'shotgun', name: 'Shotgun', kind: 'gun', gun: { energy: 170, mass: 0.0035, speed: 400, calibre: 0.0084, channel: 0.005, soft: 9, hard: 90, rounds: 2, every: 0.25,
        pellets: 9, spread: 0.028, kick: 0.12, sound: 'shot-shotgun', reload: 2.2 } as Gun },
    // 7.62x39: a 7.9 g bullet at 715 m/s, about 2 kJ, 600 a minute. It goes some way into a body before it yaws.
    { key: 'ak', name: 'AK-47', kind: 'gun', gun: { energy: 2020, mass: 0.0079, speed: 715, calibre: 0.0078, channel: 0.011, soft: 24, hard: 150, rounds: 30, every: 0.1,
        pellets: 1, spread: 0.0035, kick: 0.022, sound: 'shot-ak', reload: 2.5, auto: true } as Gun },
    // 5.56x45 M855 from a 14.5 inch barrel: 4 g at 900 m/s, about 1.6 kJ, 800 a minute. Fast enough to break up inside.
    { key: 'm4', name: 'M4A1', kind: 'gun', gun: { energy: 1620, mass: 0.004, speed: 900, calibre: 0.0057, channel: 0.013, soft: 22, hard: 130, rounds: 30, every: 0.075,
        pellets: 1, spread: 0.0025, kick: 0.016, sound: 'shot-m4', reload: 2.3, auto: true } as Gun },
    { key: 'grenade', name: 'M67 grenade', kind: 'grenade' },
    { key: 'hands', name: 'Hands', kind: 'grab' },
    { key: 'throw', name: 'Throw things', kind: 'throw' },
];

// Things to throw: the props from Poly Haven already in the game, and what each weighs.
// And how stiff each is where it lands, N/m (none: hard as the bone it hits); a cardboard box crumples.
const THROWN: [string, number, number?][] = [['metal_toolbox', 6], ['concrete_cat_statue', 4], ['dining_chair_02', 5], ['wooden_bucket_01', 2], ['cardboard_box_01', 0.6, 4000],
    ['vintage_electric_kettle', 1.2, 30000], ['metal_trash_can', 7, 60000]];

export class Weapons {
    declare world: any;
    declare current: number;
    declare hand: BABYLON.TransformNode;
    declare models: Map<string, BABYLON.TransformNode>;
    declare ammo: Map<string, number>;
    declare busy: number;
    declare action: any;
    declare recoil: number;
    declare flash: BABYLON.PointLight;
    declare flashCard: BABYLON.Mesh;
    declare holes: BABYLON.Mesh;
    declare holeCount: number;
    declare grab: any;
    declare thrown: any[];
    declare throwKind: number;
    declare casings: any[];
    declare reloading: number;
    declare firing: boolean;
    declare _anchors: Map<string, any>;
    declare slots: (string | null)[];
    declare bag: (string | null)[];
    declare slot: number;
    declare arsenal: any;
    declare grenades: any[];
    declare flashAt: number;

    constructor(world) {
        this.world = world;
        // What is carried: six at hand (1 to 6), twelve more in the bag. An empty hand is the hands.
        this.slots = ['pistol', 'knife', null, null, null, null];
        this.bag = new Array(12).fill(null);
        this.slot = 0;
        this.current = 0;
        this.arsenal = null;
        this.grenades = [];
        const { scene, camera } = world;
        this.hand = new BABYLON.TransformNode('hand', scene);
        this.hand.parent = camera;
        this.models = new Map();
        this._anchors = new Map();
        this.ammo = new Map(ARMS.filter((a) => a.gun).map((a) => [a.key, a.gun.rounds]));
        this.busy = 0;
        this.action = null;
        this.recoil = 0;
        this.reloading = 0;
        this.firing = false;
        this.grab = null;
        this.thrown = [];
        this.throwKind = 0;
        this.casings = [];

        this.flash = new BABYLON.PointLight('muzzle', V3.Zero(), scene);
        this.flash.intensity = 0;
        this.flash.range = 8;
        this.flash.diffuse = new BABYLON.Color3(1, 0.75, 0.45);
        this.flashCard = BABYLON.MeshBuilder.CreatePlane('flash', { size: 0.16 }, scene);
        const fm = new BABYLON.StandardMaterial('flash', scene);
        fm.emissiveTexture = flashTexture(scene);
        fm.opacityTexture = fm.emissiveTexture;
        fm.disableLighting = true;
        fm.alphaMode = BABYLON.Engine.ALPHA_ADD;
        this.flashCard.material = fm;
        this.flashCard.isPickable = false;
        this.flashCard.setEnabled(false);
        this.flashCard.billboardMode = BABYLON.Mesh.BILLBOARDMODE_ALL;

        // Bullet holes in the room.
        this.holes = BABYLON.MeshBuilder.CreatePlane('holes', { size: 1 }, scene);
        const hm = new BABYLON.PBRMaterial('holes', scene);
        hm.albedoTexture = holeTexture(scene);
        hm.useAlphaFromAlbedoTexture = true;
        hm.transparencyMode = BABYLON.Material.MATERIAL_ALPHABLEND;
        hm.metallic = 0; hm.roughness = 0.9; hm.zOffset = -2;
        hm.useSpecularOverAlpha = false;
        hm.useRadianceOverAlpha = false;
        this.holes.material = hm;
        this.holes.isPickable = false;
        this.holes.alwaysSelectAsActiveMesh = true;
        this.holes.thinInstanceSetBuffer('matrix', new Float32Array(600 * 16), 16, false);
        this.holes.thinInstanceCount = 0;
        this.holes.isVisible = false;
        this.holeCount = 0;
        this._input();
    }

    get arm() { return ARMS[this.current]; }

    // The models, once: each turned so its grip is at the hand and it points ahead.
    async load() {
        const json = await (await fetch('assets/models/weapons/weapons.json')).json();
        const { scene } = this.world;
        await Promise.all(Object.entries(json).map(async ([key, j]: [string, any]) => {
            const { root } = await place(scene, 'weapons/' + j.file.replace(/\.glb$/, ''));
            root.computeWorldMatrix(true);
            const m = root.getWorldMatrix();
            const p = (a) => V3.TransformCoordinates(V3.FromArray(a), m);
            const grip = p(j.grip), tip = p(j.tip), up = p(j.grip.map((x, i) => x + j.up[i])).subtract(grip);
            const forward = tip.subtract(grip).normalize();
            // (Measured: turned only so, every model came out pointing back at the eye; half a turn about its own up
            // puts it the right way round.)
            const turn = Q.RotationAxis(V3.Up(), Math.PI).multiply(Q.Inverse(Q.FromLookDirectionLH(forward, up.subtract(forward.scale(V3.Dot(up, forward))).normalize())));
            const align = new BABYLON.TransformNode('hold_' + key, scene);
            align.rotationQuaternion = turn;
            align.position = grip.applyRotationQuaternion(turn).scale(-1);
            root.parent = align;
            align.parent = this.hand;
            for (const mesh of root.getChildMeshes()) {
                mesh.isPickable = false;
                mesh.receiveShadows = true;
                this.world.shadows?.addShadowCaster(mesh);
            }
            align.setEnabled(false);
            this.models.set(key, align);
            // Where the muzzle and the port are, in the hand's frame.
            const local = (a) => (a ? p(a).applyRotationQuaternion(turn).add(align.position) : null);
            this._anchors.set(key, { tip: local(j.tip), ejection: local(j.ejection), eject: j.ejectDir ? V3.FromArray(j.ejectDir) : V3.Right() });
        }));
        this.select(this.slot);
    }

    // The slot at hand `i` (0 to 5) taken up: whatever is in it, or the bare hands.
    select(i) {
        if (i < 0 || i >= this.slots.length) return;
        this._letGo();
        this.slot = i;
        this.current = ARMS.findIndex((a) => a.key === (this.slots[i] ?? 'hands'));
        this.action = null;
        this.reloading = 0;
        for (const [key, node] of this.models) node.setEnabled(key === this.arm.key);
        const held = HELD[this.arm.key];
        if (held) {
            this.hand.position.set(held.at[0], held.at[1], held.at[2]);
            this.hand.rotation.set(held.turn[0], held.turn[1], held.turn[2]);
        }
    }

    _input() {
        const { canvas } = this.world;
        const down = (e) => {
            if (document.pointerLockElement !== canvas) return;
            if (e.button === 0) this.firing = true;
            this._press(e.button);
        };
        const up = (e) => { if (e.button === 0) { this.firing = false; this._letGo(); } };
        const key = (e) => {
            if (document.pointerLockElement !== canvas) return;
            if (/^Digit[1-6]$/.test(e.code)) this.select(Number(e.code.slice(5)) - 1);
            if (e.code === 'KeyR') this._reload();
            if (e.code === 'KeyE') this.take(this.looking());
            if (e.code === 'KeyG') this.putBack();
        };
        const wheel = (e) => this.select((this.slot + (e.deltaY > 0 ? 1 : -1) + this.slots.length) % this.slots.length);
        // Pointer events, not mouse ones: Babylon cancels pointerdown, and a cancelled pointerdown has no mousedown after it.
        canvas.addEventListener('pointerdown', down);
        window.addEventListener('pointerup', up);
        window.addEventListener('keydown', key);
        canvas.addEventListener('wheel', wheel, { passive: true });
        canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    _press(button) {
        const arm = this.arm;
        if (this.busy > 0 || this.reloading > 0) return;
        if (arm.kind === 'gun' && button === 0) this._fire();
        else if (arm.kind === 'blade') this._swing(button === 0 ? 'stab' : 'cut');
        else if (arm.kind === 'blunt' && button === 0) this._swing('blow');
        else if (arm.kind === 'grab' && button === 0) this._take();
        else if (arm.kind === 'grab' && button === 2) this._punch();
        else if (arm.kind === 'throw') button === 0 ? this._throw() : (this.throwKind = (this.throwKind + 1) % THROWN.length);
        else if (arm.kind === 'grenade') this._lob(button === 0 ? 14 : 6);
    }

    // --- what is carried ----------------------------------------------------------------------

    // What on the arsenal the eye is on, if anything.
    looking(): string | null {
        if (!this.arsenal) return null;
        const { camera } = this.world;
        return this.arsenal.look(camera.globalPosition, camera.getDirection(V3.Forward()));
    }

    // `key` from the arsenal into the hand: into the slot held if it is empty, else the first empty one, else in place
    // of what is held (which goes back on the wall). What is carried already is just taken up.
    take(key: string | null) {
        if (!key) return;
        const have = this.slots.indexOf(key);
        if (have >= 0) { this.select(have); return; }
        const into = this.slots[this.slot] === null ? this.slot : this.slots.indexOf(null);
        this.slots[into >= 0 ? into : this.slot] = key;
        this.select(into >= 0 ? into : this.slot);
        this.world.sound?.shot('rack', { gain: 0.35, rate: 1.3 });
    }

    // What is held, back on the wall.
    putBack() {
        if (this.slots[this.slot] === null) return;
        this.slots[this.slot] = null;
        this.select(this.slot);
    }

    // Two places swapped (from the inventory screen): `list` 'slots' or 'bag'.
    move(fromList: 'slots' | 'bag', from: number, toList: 'slots' | 'bag', to: number) {
        const a = this[fromList], b = this[toList];
        [a[from], b[to]] = [b[to], a[from]];
        this.select(this.slot);
    }

    // --- guns ---------------------------------------------------------------------------

    _fire() {
        const { key, gun } = this.arm;
        if (this.ammo.get(key) <= 0) { this._reload(); return; }
        this.ammo.set(key, this.ammo.get(key) - 1);
        this.busy = gun.every;
        this.recoil = 1;
        const { camera, sound } = this.world;
        const eye = camera.globalPosition.clone(), ahead = camera.getDirection(V3.Forward());
        // A shotgun's charge flies as one mass for the first metre or so before the pellets part: up to about 1.2 m it
        // makes one round hole 2 to 2.5 cm across and goes in as a single heavy missile, wrecking everything along a
        // wide track (dev/research/wounds.md). Further off, the pellets go their own ways.
        const near = gun.pellets > 1 ? this._person(eye, ahead, 1.4) : null;
        if (near && near.t + 0.5 < 1.3) {
            const off = near.t + 0.5;
            this._shot(eye, jitter(ahead, gun.spread * 0.05), { ...gun, energy: gun.energy * gun.pellets * (1 - off * 0.1), mass: gun.mass * gun.pellets,
                calibre: off < 0.6 ? 0.022 : 0.026, channel: 0.024, soft: 42, hard: 120, pellets: 1 });
        } else for (let p = 0; p < gun.pellets; p++) this._shot(eye, jitter(ahead, gun.spread), { ...gun });
        sound?.shot(gun.sound, { gain: 1 });
        // The flash at the muzzle, for a frame or two.
        const anchors = this._anchors.get(key);
        const muzzle = anchors?.tip ? V3.TransformCoordinates(anchors.tip, this.hand.getWorldMatrix()) : eye.add(ahead.scale(0.6));
        this.flash.position.copyFrom(muzzle);
        this.flash.intensity = 40;
        this.flashAt = performance.now();
        this.flashCard.position.copyFrom(muzzle.add(ahead.scale(0.05)));
        this.flash.range = 8;
        this.flashCard.scaling.setAll(gun.pellets > 1 ? 1.6 : key === 'pistol' ? 1 : 1.35);
        this.flashCard.rotation.z = Math.random() * Math.PI;
        this.flashCard.setEnabled(true);
        this.world.player.pitch -= gun.kick * (0.6 + Math.random() * 0.4);
        this.world.player.yaw += (Math.random() - 0.5) * gun.kick * 0.4;
        if (key !== 'shotgun' && anchors?.ejection) this._eject(anchors, key);
        if (key === 'rifle') setTimeout(() => sound?.shot('rack', { gain: 0.8 }), 450);
    }

    // One bullet or pellet from `from` along `dir`, followed through whoever it goes through.
    _shot(from: BABYLON.Vector3, dir: BABYLON.Vector3, m: Gun) {
        let origin = from.clone(), energy = m.energy;
        for (let leg = 0; leg < 6 && energy > 15; leg++) {
            const wall = this._wall(origin, dir);
            const person = this._person(origin, dir, wall ? wall.distance : 200);
            if (!person) {
                if (wall) this._hole(wall.point, wall.normal, m.calibre);
                return;
            }
            const res = pierce(person.npc, origin, dir, { ...m, energy }, Math.min(3, (wall?.distance ?? 200) - person.t + 2) + person.t);
            if (!res.hit) { origin = origin.add(dir.scale(person.t + 0.3)); continue; }
            if (res.stopped || !res.at) return;
            energy = res.energy;
            origin = res.at.add(dir.scale(0.02));
        }
    }

    // The nearest person a line could meet: tested against their segments first, which is cheap.
    _person(origin, dir, far) {
        let best = null;
        for (const npc of this.world.npcs) {
            for (const seg of npc.ragdoll.segments) {
                const [a, b] = npc.ragdoll.segmentEnds(seg);
                const { t, distance } = rayToSegment(origin, dir, a, b);
                if (t > 0 && t < far && distance < seg.radius + 0.12 && (!best || t < best.t)) best = { npc, t: Math.max(0, t - 0.5) };
            }
        }
        return best;
    }

    // The room's walls, floor and fixed things: where a line meets them.
    _wall(origin, dir) {
        const pick = this.world.scene.pickWithRay(new BABYLON.Ray(origin, dir, 200), (m) => m.metadata?.solid);
        if (!pick?.hit) return null;
        return { distance: pick.distance, point: pick.pickedPoint, normal: pick.getNormal(true) ?? dir.scale(-1) };
    }

    _hole(at, normal, calibre) {
        const n = normal.normalize();
        const side = V3.Cross(n, Math.abs(n.y) > 0.9 ? V3.Right() : V3.Up()).normalize();
        const across = V3.Cross(n, side).normalize();
        const s = calibre * 2.4;
        const m = BABYLON.Matrix.FromValues(side.x * s, side.y * s, side.z * s, 0, across.x * s, across.y * s, across.z * s, 0, -n.x, -n.y, -n.z, 0,
            at.x + n.x * 0.001, at.y + n.y * 0.001, at.z + n.z * 0.001, 1);
        this.holes.thinInstanceSetMatrixAt(this.holeCount % 600, m, true);
        this.holeCount++;
        this.holes.thinInstanceCount = Math.min(600, this.holeCount);
        this.holes.isVisible = true;
    }

    _eject(anchors, key) {
        const { scene, sound } = this.world;
        const at = V3.TransformCoordinates(anchors.ejection, this.hand.getWorldMatrix());
        const long = { rifle: [0.051, 0.012], ak: [0.039, 0.0113], m4: [0.045, 0.0096] }[key] ?? [0.019, 0.0098];
        const brass = BABYLON.MeshBuilder.CreateCylinder('casing', { height: long[0], diameter: long[1], tessellation: 10 }, scene);
        brass.material = scene.getMaterialByName('brass') ?? Object.assign(new BABYLON.PBRMaterial('brass', scene), { albedoColor: new BABYLON.Color3(0.78, 0.56, 0.24), metallic: 1, roughness: 0.3 });
        brass.position.copyFrom(at);
        const body = new BABYLON.PhysicsAggregate(brass, BABYLON.PhysicsShapeType.CYLINDER, { mass: 0.01, restitution: 0.4, friction: 0.6 }, scene);
        const right = this.world.camera.getDirection(V3.Right()), up = this.world.camera.getDirection(V3.Up());
        body.body.setLinearVelocity(right.scale(2 + Math.random()).add(up.scale(1.5 + Math.random())));
        body.body.setAngularVelocity(new V3(Math.random() * 20, Math.random() * 20, 0));
        this.casings.push({ mesh: brass, body });
        if (this.casings.length > 40) { const old = this.casings.shift(); old.body.dispose(); old.mesh.dispose(); }
        setTimeout(() => sound?.shot('casing', { at: brass.position.asArray(), gain: 0.5 }), 500 + Math.random() * 200);
    }

    _reload() {
        const { key, gun } = this.arm;
        if (!gun || this.reloading > 0 || this.ammo.get(key) === gun.rounds) return;
        this.reloading = gun.reload;
        this.world.sound?.shot('rack', { gain: 0.9 });
    }

    // --- blades and the bat -----------------------------------------------------------------

    _swing(how) {
        const arm = this.arm;
        this.busy = how === 'stab' ? 0.35 : arm.swing;
        this.action = { how, t: 0, length: this.busy, hits: new Map(), landed: false };
        this.world.sound?.shot('swing', { gain: how === 'stab' ? 0.5 : 0.9, rate: arm.key === 'knife' ? 1.25 : 1 });
        if (how === 'stab') {
            const { camera } = this.world;
            const eye = camera.globalPosition.clone(), ahead = camera.getDirection(V3.Forward());
            const person = this._person(eye, ahead, arm.reach);
            if (!person) return;
            const skin = person.npc.surface(eye, ahead, arm.reach).find((h) => h.kind === 'skin');
            if (!skin) return;
            setTimeout(() => {
                pierce(person.npc, eye, ahead, arm.stab, arm.reach + arm.stab.reach);
                this.world.sound?.shot('stab', { at: skin.point.asArray() });
            }, 90);
        }
    }

    // A cut or a blow under way: a fan of lines from the eye, swept from right to left over the middle of the swing.
    _sweep(dt) {
        const a = this.action, arm = this.arm;
        a.t += dt;
        const p = a.t / a.length;
        if (p < 0.2 || p > 0.75 || a.how === 'stab') return;
        const { camera } = this.world;
        const eye = camera.globalPosition.clone();
        const turn = 0.75 - ((p - 0.2) / 0.55) * 1.5;
        const dir = V3.TransformNormal(new V3(Math.sin(turn), -0.12 + (p - 0.2) * 0.35, Math.cos(turn)).normalize(), camera.getWorldMatrix());
        const person = this._person(eye, dir, arm.reach);
        if (!person) return;
        const npc = person.npc;
        if (a.how === 'blow') {
            if (a.landed) return;
            const skin = npc.surface(eye, dir, arm.reach).find((h) => h.kind === 'skin' || h.kind === 'cloth');
            if (!skin) return;
            a.landed = true;
            // The bat moves across the eye's line, and on into them.
            const across = V3.TransformNormal(new V3(-1, 0, 0.35).normalize(), camera.getWorldMatrix());
            blow(npc, skin.point, across, arm.mass, arm.speed);
            this.world.sound?.shot('blunt', { at: skin.point.asArray() });
            this.action.t = Math.max(this.action.t, this.action.length * 0.75);
            return;
        }
        const res = pierce(npc, eye, dir, { energy: arm.key === 'sword' ? 90 : 35, mass: 0.3, calibre: 0.004, channel: arm.cut * 0.5, soft: 0.8, hard: 60, reach: arm.cut,
            blade: true, slash: true }, arm.reach + arm.cut);
        if (!res.hit || !res.enter) return;
        // The cut itself is made once the swing is through, along every place it crossed the skin (npc.slash).
        if (!a.hits.has(npc)) { a.hits.set(npc, []); this.world.sound?.shot('skin', { at: res.enter.point.asArray(), gain: 0.9 }); }
        a.hits.get(npc).push(res.enter);
        this.world.blood.spray(res.enter.point, res.enter.normal.add(dir.scale(-0.6)).normalize(), 1.5, arm.key === 'sword' ? 6 : 2, 0.4);
    }

    // --- hands: picking a body up and dragging it -------------------------------------------

    _take() {
        const { camera } = this.world;
        const eye = camera.globalPosition.clone(), ahead = camera.getDirection(V3.Forward());
        // Bowel that has come out is taken hold of before the body it came out of.
        const bowel = viscera.pick(this.world.npcs, eye, ahead, 3);
        if (bowel) { this.grab = { bowel, distance: bowel.distance }; return; }
        const person = this._person(eye, ahead, 3);
        if (person) {
            const skin = person.npc.surface(eye, ahead, 3)[0];
            if (!skin) return;
            person.npc.grabbed = true;
            person.npc.knockDown();
            const { seg } = person.npc.ragdoll.nearest(skin.point);
            const local = V3.TransformCoordinates(skin.point, seg.node.computeWorldMatrix(true).clone().invert());
            this.grab = { body: seg.body, node: seg.node, local, distance: V3.Distance(eye, skin.point), mass: seg.mass, npc: person.npc };
            return;
        }
        // Or a thing.
        const pick = this.world.scene.pickWithRay(new BABYLON.Ray(eye, ahead, 3), (m) => !!m.physicsBody && m.physicsBody.getMotionType() === BABYLON.PhysicsMotionType.DYNAMIC);
        if (pick?.hit) {
            const node = pick.pickedMesh as BABYLON.Mesh;
            const local = V3.TransformCoordinates(pick.pickedPoint, node.computeWorldMatrix(true).clone().invert());
            this.grab = { body: node.physicsBody, node, local, distance: pick.distance, mass: node.physicsBody.getMassProperties().mass ?? 1 };
        }
    }

    // A punch: an untrained man's, 500 to 850 N, about 45 J behind a fist and forearm (dev/research/blunt-trauma.md).
    _punch() {
        this.busy = 0.45;
        const { camera } = this.world;
        const eye = camera.globalPosition.clone(), ahead = camera.getDirection(V3.Forward());
        this.world.sound?.shot('swing', { gain: 0.35, rate: 1.4 });
        const person = this._person(eye, ahead, 0.85);
        if (!person) return;
        const hit = person.npc.surface(eye, ahead, 0.85).find((h) => h.kind === 'skin' || h.kind === 'cloth');
        if (!hit) return;
        setTimeout(() => {
            // A fist and the arm behind it give: about 9 kN/m, which is what makes 1.8 kg at 7 m/s land with the 500 to
            // 850 N an untrained punch is measured at (dev/research/blunt-trauma.md), not with the force of a brick.
            blow(person.npc, hit.point, ahead, 1.8, 7, 9000);
            this.world.sound?.shot('blunt', { at: hit.point.asArray(), gain: 0.6 });
        }, 110);
    }

    _hold(dt) {
        const g = this.grab;
        if (!g) return;
        const { camera } = this.world;
        const target = camera.globalPosition.add(camera.getDirection(V3.Forward()).scale(Math.min(g.distance, 2.2)));
        if (g.bowel) { viscera.pull(g.bowel, target); return; }
        const at = V3.TransformCoordinates(g.local, g.node.computeWorldMatrix(true));
        const v = g.body.getLinearVelocity();
        // A stiff spring on the point that was taken hold of, damped, as strong as two arms.
        const force = target.subtract(at).scale(320 * Math.min(g.mass, 12)).subtract(v.scale(28 * Math.min(g.mass, 12)));
        const most = 900;
        if (force.length() > most) force.scaleInPlace(most / force.length());
        g.body.applyImpulse(force.scale(dt), at);
    }

    _letGo() {
        if (!this.grab) return;
        if (this.grab.npc) this.grab.npc.grabbed = false;
        if (this.grab.bowel) viscera.letGo(this.grab.bowel);
        this.grab = null;
    }

    // --- throwing things ---------------------------------------------------------------------

    async _throw() {
        const { scene, camera, models, bodyOf } = this.world;
        const [name, mass, stiffness] = THROWN[this.throwKind];
        this.busy = 0.35;
        await models.prepare([name]);
        const source = models.sources.get(name);
        if (!source) return;
        const mesh = source.createInstance(name + '_thrown');
        mesh.isPickable = true;
        const ahead = camera.getDirection(V3.Forward());
        mesh.position.copyFrom(camera.globalPosition.add(ahead.scale(0.8)).add(new V3(0, -0.25, 0)));
        mesh.rotation.set(Math.random(), Math.random() * 6, 0);
        this.world.shadows?.addShadowCaster(mesh);
        const agg = new BABYLON.PhysicsAggregate(mesh, BABYLON.PhysicsShapeType.CONVEX_HULL, { mass, friction: 0.6, restitution: 0.15 }, scene);
        agg.body.setLinearVelocity(ahead.scale(mass > 4 ? 9 : 13));
        agg.body.setAngularVelocity(new V3(Math.random() * 6 - 3, Math.random() * 6 - 3, Math.random() * 6 - 3));
        agg.body.setCollisionCallbackEnabled(true);
        let last = 0;
        agg.body.getCollisionObservable().add((e) => {
            const who = bodyOf.get(e.collidedAgainst);
            const speed = agg.body.getLinearVelocity().length();
            const now = performance.now();
            if (!who || speed < 3 || now - last < 250) return;
            last = now;
            blow(who.npc, e.point ?? who.seg.node.position, agg.body.getLinearVelocity().normalize(), mass, speed, stiffness);
            this.world.sound?.shot('blunt', { at: (e.point ?? mesh.position).asArray(), gain: Math.min(1, speed / 10) });
        });
        this.thrown.push({ mesh, agg });
        if (this.thrown.length > 30) { const old = this.thrown.shift(); old.agg.dispose(); old.mesh.dispose(); }
    }

    get throwing() { return THROWN[this.throwKind][0].replace(/_\d+$/, '').replace(/_/g, ' '); }

    // --- the grenade ----------------------------------------------------------------------------

    // An M67: pin out, lever off as it leaves the hand, and a fuse of four to five and a half seconds. Thrown overarm
    // (left) or rolled underhand (right) at `speed` m/s.
    _lob(speed: number) {
        const { scene, camera, sound, bodyOf } = this.world;
        const model = this.models.get('grenade');
        if (!model) return;
        this.busy = 0.9;
        sound?.shot('pin', { gain: 0.7 });
        setTimeout(() => {
            const ahead = camera.getDirection(V3.Forward()), up = camera.getDirection(V3.Up());
            const node = model.instantiateHierarchy(null, { doNotInstantiate: true });
            node.parent = null;
            node.setEnabled(true);
            node.position.copyFrom(camera.globalPosition.add(ahead.scale(0.4)).add(up.scale(speed > 10 ? 0.1 : -0.3)));
            const meshes = node.getChildMeshes();
            for (const m of meshes) this.world.shadows?.addShadowCaster(m);
            // The physics on a sphere the size of the body (64 mm across, 400 g) that carries the model with it.
            const ball = BABYLON.MeshBuilder.CreateSphere('grenade', { diameter: 0.064, segments: 6 }, scene);
            ball.isVisible = false;
            ball.isPickable = false;
            ball.position.copyFrom(node.position);
            node.position.setAll(0);
            node.parent = ball;
            const agg = new BABYLON.PhysicsAggregate(ball, BABYLON.PhysicsShapeType.SPHERE, { mass: 0.4, friction: 0.7, restitution: 0.3 }, scene);
            agg.body.setLinearVelocity(ahead.scale(speed).add(up.scale(speed > 10 ? 2.5 : 0)));
            agg.body.setAngularVelocity(new V3(Math.random() * 10 - 5, Math.random() * 10 - 5, Math.random() * 10 - 5));
            agg.body.setAngularDamping(0.6);
            agg.body.setCollisionCallbackEnabled(true);
            let last = 0;
            agg.body.getCollisionObservable().add((e) => {
                const v = agg.body.getLinearVelocity().length(), now = performance.now();
                if (v < 1.2 || now - last < 120) return;
                last = now;
                this.world.sound?.shot('bounce-metal', { at: ball.position.asArray(), gain: Math.min(1, v / 8) });
                const who = bodyOf.get(e.collidedAgainst);
                if (who && v > 5) blow(who.npc, e.point ?? ball.position, agg.body.getLinearVelocity().normalize(), 0.4, v,);
            });
            this.grenades.push({ ball, node, agg, fuse: 4 + Math.random() * 1.5 });
        }, 220);
    }

    _fuses(dt) {
        for (const g of this.grenades) if ((g.fuse -= dt) <= 0) this._explode(g);
        this.grenades = this.grenades.filter((g) => g.fuse > 0);
    }

    // 180 g of Composition B in a steel body that breaks into a few hundred fragments: killing within 5 m, wounding to
    // 15. The blast throws and knocks down whoever is close; the fragments go out every way as missiles of their own.
    _explode(g) {
        const { scene, sound, player } = this.world;
        const at = g.ball.position.clone();
        g.agg.dispose();
        g.node.dispose(false, true);
        g.ball.dispose();
        sound?.shot('explosion', { at: at.asArray(), gain: 1 });
        this.flash.position.copyFrom(at.add(new V3(0, 0.3, 0)));
        this.flash.range = 16;
        this.flash.intensity = 900;
        this.flashAt = performance.now();
        this.flashCard.position.copyFrom(at.add(new V3(0, 0.25, 0)));
        this.flashCard.scaling.setAll(6);
        this.flashCard.rotation.z = Math.random() * Math.PI;
        this.flashCard.setEnabled(true);
        smoke(scene, at);

        // The blast: an impulse on every part of everyone near, falling off with the square of the distance; limbs near
        // enough torn off and a belly burst (180 g of Composition B is about 0.25 kg of TNT).
        for (const npc of this.world.npcs) {
            blast(npc, at, 0.25);
            const centre = npc.ragdoll.centre, d = Math.max(0.4, V3.Distance(at, centre));
            if (d > 8) continue;
            const total = Math.min(60, 35 / (d * d));          // N s on the whole body
            for (const seg of npc.ragdoll.segments) {
                if (!seg.body) continue;
                const p = seg.node.getAbsolutePosition();
                const dir = p.subtract(at).normalize().add(new V3(0, 0.35, 0)).normalize();
                seg.body.applyImpulse(dir.scale(total * seg.mass / npc.ragdoll.mass), p);
            }
            if (d < 3.5) {
                npc.knockDown();
                const near = npc.ragdoll.nearest(at);
                const point = near.seg.node.getAbsolutePosition();
                blow(npc, point, point.subtract(at).normalize(), 2, Math.min(18, 12 / d), 'flat');
            }
        }

        // The fragments, about a thousand, each spending its energy against air first (half its speed in 15 m). Followed
        // one by one only where they meet somebody: each part of each person takes as many as the share of the sphere it
        // covers seen from the burst. A few hundred more go out every way, for the marks they leave on the room.
        const frag: Gun = { name: 'fragment', energy: 330, mass: 0.0003, speed: 1500, calibre: 0.004, channel: 0.004, soft: 18, hard: 110, rounds: 0, every: 0,
            pellets: 1, spread: 0, kick: 0, sound: '', reload: 0 };
        const fly = (dir: BABYLON.Vector3, far: number) => this._shot(at, dir, { ...frag, energy: frag.energy * Math.exp(-far / 10.8) });
        for (const npc of this.world.npcs) {
            for (const seg of npc.ragdoll.segments) {
                const [a, b] = npc.ragdoll.segmentEnds(seg), mid = a.add(b).scale(0.5), d = V3.Distance(at, mid);
                if (d > 25) continue;
                const area = 2 * seg.radius * (V3.Distance(a, b) + 2 * seg.radius);
                const expected = FRAGMENTS * area / (4 * Math.PI * d * d);
                for (let n = Math.floor(expected + Math.random()); n > 0; n--) {
                    const aim = V3.Lerp(a, b, Math.random()).add(new V3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).scale(seg.radius * 1.6));
                    fly(aim.subtract(at).normalize(), Math.max(0, d - 0.3));
                }
            }
        }
        for (let i = 0; i < 160; i++) {
            const y = Math.random() * 1.6 - 0.6, r = Math.sqrt(1 - y * y), a = Math.random() * Math.PI * 2;
            const dir = new V3(Math.cos(a) * r, y, Math.sin(a) * r);
            if (!this._person(at, dir, 25)) fly(dir, 0);
        }

        // The player feels it.
        const d = V3.Distance(at, this.world.camera.globalPosition);
        if (d < 14) {
            player.pitch -= (Math.random() * 0.08 + 0.04) * Math.min(1, 3 / d);
            player.yaw += (Math.random() - 0.5) * 0.08 * Math.min(1, 3 / d);
        }
    }

    // --- every frame --------------------------------------------------------------------------

    update(dt) {
        this.busy = Math.max(0, this.busy - dt);
        if (this.reloading > 0 && (this.reloading -= dt) <= 0) this.ammo.set(this.arm.key, this.arm.gun.rounds);
        if (this.firing && this.arm.key === 'pistol' && this.busy <= 0) this.firing = false;
        // Held down, an automatic keeps firing until it is empty.
        if (this.firing && this.arm.gun?.auto && this.busy <= 0 && this.reloading <= 0) {
            if (this.ammo.get(this.arm.key) > 0) this._fire();
            else { this.firing = false; this._reload(); }
        }
        this._fuses(dt);
        if (this.action) {
            this._sweep(dt);
            if (this.action.t >= this.action.length) {
                const sweep = this.world.camera.getDirection(V3.Left());
                for (const [npc, hits] of this.action.hits) npc.slash(hits, this.arm.cut ?? 0.02, sweep);
                this.action = null;
            }
        }
        this._hold(dt);
        // The flash goes as fast as it came.
        // By the clock, not by frames: a frame held up by a limb coming off must not keep a flash on screen.
        if (this.flash.intensity > 0) {
            const age = (performance.now() - this.flashAt) / 1000;
            this.flash.intensity *= Math.exp(-age * 40);
            if (this.flash.intensity < 1 || age > 0.12) { this.flash.intensity = 0; this.flashCard.setEnabled(false); }
        }
        this._animate(dt);
    }

    // The hand: kicked back by a shot, swung through a cut, lowered while reloading.
    _animate(dt) {
        const held = HELD[this.arm.key];
        if (!held) return;
        this.recoil *= Math.exp(-dt * 14);
        const pos = new V3(held.at[0], held.at[1], held.at[2] - this.recoil * 0.06);
        const rot = new V3(held.turn[0] - this.recoil * 0.25, held.turn[1], held.turn[2]);
        if (this.reloading > 0) { pos.y -= 0.12; rot.x += 0.5; }
        const a = this.action;
        if (a) {
            const p = Math.min(1, a.t / a.length), arc = Math.sin(p * Math.PI);
            if (a.how === 'stab') pos.z += arc * 0.3;
            else {
                rot.y += 0.9 - p * 1.8;
                rot.x += 0.6 * arc;
                pos.x -= p * 0.35;
                pos.y += arc * 0.1;
            }
        }
        this.hand.position.copyFrom(pos);
        this.hand.rotation.copyFrom(rot);
    }
}

// A grey cloud where the grenade was, rising and spreading for a few seconds.
let smokeTexture: BABYLON.DynamicTexture | null = null;
function smoke(scene, at: BABYLON.Vector3) {
    if (!smokeTexture) {
        smokeTexture = new BABYLON.DynamicTexture('smoke', 64, scene, false);
        const ctx = smokeTexture.getContext();
        const g = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
        g.addColorStop(0, 'rgba(255,255,255,0.55)');
        g.addColorStop(0.6, 'rgba(255,255,255,0.18)');
        g.addColorStop(1, 'rgba(255,255,255,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, 64, 64);
        smokeTexture.hasAlpha = true;
        smokeTexture.update();
    }
    const ps = new BABYLON.ParticleSystem('smoke', 90, scene);
    ps.particleTexture = smokeTexture;
    ps.emitter = at.add(new V3(0, 0.2, 0));
    ps.createSphereEmitter(0.3);
    ps.color1 = new BABYLON.Color4(0.55, 0.53, 0.5, 0.85);
    ps.color2 = new BABYLON.Color4(0.4, 0.39, 0.37, 0.75);
    ps.colorDead = new BABYLON.Color4(0.25, 0.25, 0.25, 0);
    ps.minSize = 0.9; ps.maxSize = 1.8;
    ps.addSizeGradient(0, 0.6);
    ps.addSizeGradient(1, 2.6);
    ps.minLifeTime = 2.5; ps.maxLifeTime = 4.5;
    ps.minEmitPower = 1.5; ps.maxEmitPower = 4;
    ps.gravity = new V3(0, 0.25, 0);
    ps.minAngularSpeed = -0.4; ps.maxAngularSpeed = 0.4;
    ps.blendMode = BABYLON.ParticleSystem.BLENDMODE_STANDARD;
    ps.manualEmitCount = 90;
    ps.disposeOnStop = true;
    ps.targetStopDuration = 5;
    ps.start();
}

function jitter(dir: BABYLON.Vector3, spread: number) {
    const a = Math.random() * Math.PI * 2, r = Math.sqrt(Math.random()) * spread;
    const side = V3.Cross(dir, V3.Up()).normalize(), up = V3.Cross(side, dir).normalize();
    return dir.add(side.scale(Math.cos(a) * r)).add(up.scale(Math.sin(a) * r)).normalize();
}

function flashTexture(scene) {
    const t = new BABYLON.DynamicTexture('flashStar', { width: 128, height: 128 }, scene, false);
    const g = t.getContext() as CanvasRenderingContext2D;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, 'rgba(255,250,230,1)');
    grad.addColorStop(0.25, 'rgba(255,190,90,0.9)');
    grad.addColorStop(1, 'rgba(255,120,30,0)');
    g.fillStyle = grad;
    for (let k = 0; k < 5; k++) {
        g.save();
        g.translate(64, 64);
        g.rotate((k / 5) * Math.PI * 2 + 0.3);
        g.beginPath();
        g.moveTo(-6, 0); g.lineTo(0, -62); g.lineTo(6, 0);
        g.fill();
        g.restore();
    }
    g.beginPath(); g.arc(64, 64, 26, 0, Math.PI * 2); g.fill();
    t.hasAlpha = true;
    t.update();
    return t;
}

function holeTexture(scene) {
    const t = new BABYLON.DynamicTexture('bulletHole', { width: 64, height: 64 }, scene, true);
    const g = t.getContext() as CanvasRenderingContext2D;
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, 'rgba(10,9,8,1)');
    grad.addColorStop(0.3, 'rgba(25,22,20,0.95)');
    grad.addColorStop(0.55, 'rgba(70,65,60,0.5)');
    grad.addColorStop(1, 'rgba(90,85,80,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
    t.hasAlpha = true;
    t.update();
    return t;
}
