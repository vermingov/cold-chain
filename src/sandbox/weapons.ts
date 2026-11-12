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
const V3 = BABYLON.Vector3, Q = BABYLON.Quaternion;

type Gun = Missile & { rounds: number; every: number; pellets: number; spread: number; kick: number; sound: string; reload: number; speed: number };

// Where each thing sits in the hand, in the eye's own frame (x right, y up, z ahead), and how it is turned there.
const HELD = {
    knife: { at: [0.24, -0.25, 0.42], turn: [-0.25, -0.1, 0.15] },
    sword: { at: [0.3, -0.33, 0.45], turn: [-0.9, -0.15, 0.25] },
    bat: { at: [0.3, -0.38, 0.32], turn: [-1.2, -0.2, 0.4] },
    pistol: { at: [0.16, -0.17, 0.4], turn: [0, 0, 0] },
    rifle: { at: [0.16, -0.19, 0.3], turn: [0, 0, 0] },
    shotgun: { at: [0.16, -0.2, 0.3], turn: [0, 0, 0] },
};

export const ARMS = [
    { key: 'knife', name: 'Knife', kind: 'blade', reach: 1.0, swing: 0.32,
        stab: { energy: 70, mass: 0.2, calibre: 0.02, channel: 0.006, soft: 1.4, hard: 40, reach: 0.17, blade: true } as Missile, cut: 0.022 },
    { key: 'sword', name: 'Sword', kind: 'blade', reach: 1.65, swing: 0.5,
        stab: { energy: 150, mass: 1.2, calibre: 0.03, channel: 0.01, soft: 1.2, hard: 40, reach: 0.75, blade: true } as Missile, cut: 0.055 },
    { key: 'bat', name: 'Baseball bat', kind: 'blunt', reach: 1.25, swing: 0.55, mass: 0.6, speed: 27 },
    { key: 'pistol', name: 'Pistol', kind: 'gun', gun: { energy: 480, mass: 0.008, speed: 360, calibre: 0.009, channel: 0.006, soft: 12, hard: 110, rounds: 15, every: 0.13,
        pellets: 1, spread: 0.004, kick: 0.035, sound: 'shot-pistol', reload: 1.6 } as Gun },
    { key: 'rifle', name: 'Rifle', kind: 'gun', gun: { energy: 2700, mass: 0.0097, speed: 820, calibre: 0.0078, channel: 0.012, soft: 28, hard: 160, rounds: 5, every: 1.1,
        pellets: 1, spread: 0.0012, kick: 0.07, sound: 'shot-rifle', reload: 2.6 } as Gun },
    { key: 'shotgun', name: 'Shotgun', kind: 'gun', gun: { energy: 170, mass: 0.0035, speed: 400, calibre: 0.0084, channel: 0.005, soft: 9, hard: 90, rounds: 2, every: 0.25,
        pellets: 9, spread: 0.028, kick: 0.12, sound: 'shot-shotgun', reload: 2.2 } as Gun },
    { key: 'hands', name: 'Hands', kind: 'grab' },
    { key: 'throw', name: 'Throw things', kind: 'throw' },
];

// Things to throw: the props from Poly Haven already in the game, and what each weighs.
const THROWN: [string, number][] = [['metal_toolbox', 6], ['concrete_cat_statue', 4], ['dining_chair_02', 5], ['wooden_bucket_01', 2], ['cardboard_box_01', 0.6],
    ['vintage_electric_kettle', 1.2], ['metal_trash_can', 7]];

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

    constructor(world) {
        this.world = world;
        this.current = 3;
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
        this.select(this.current);
    }

    select(i) {
        if (i < 0 || i >= ARMS.length) return;
        this._letGo();
        this.current = i;
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
            if (/^Digit[1-8]$/.test(e.code)) this.select(Number(e.code.slice(5)) - 1);
            if (e.code === 'KeyR') this._reload();
        };
        const wheel = (e) => this.select((this.current + (e.deltaY > 0 ? 1 : -1) + ARMS.length) % ARMS.length);
        canvas.addEventListener('mousedown', down);
        window.addEventListener('mouseup', up);
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
        else if (arm.kind === 'throw') button === 0 ? this._throw() : (this.throwKind = (this.throwKind + 1) % THROWN.length);
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
        for (let p = 0; p < gun.pellets; p++) this._shot(eye, jitter(ahead, gun.spread), { ...gun });
        sound?.shot(gun.sound, { gain: 1 });
        // The flash at the muzzle, for a frame or two.
        const anchors = this._anchors.get(key);
        const muzzle = anchors?.tip ? V3.TransformCoordinates(anchors.tip, this.hand.getWorldMatrix()) : eye.add(ahead.scale(0.6));
        this.flash.position.copyFrom(muzzle);
        this.flash.intensity = 40;
        this.flashCard.position.copyFrom(muzzle.add(ahead.scale(0.05)));
        this.flashCard.scaling.setAll(gun.pellets > 1 ? 1.6 : key === 'rifle' ? 1.4 : 1);
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
        const brass = BABYLON.MeshBuilder.CreateCylinder('casing', { height: key === 'rifle' ? 0.039 : 0.019, diameter: key === 'rifle' ? 0.011 : 0.0098, tessellation: 10 }, scene);
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
        const last = a.hits.get(npc);
        if (last) npc.marks.cut(last, res.enter, arm.cut);
        else this.world.sound?.shot('skin', { at: res.enter.point.asArray(), gain: 0.9 });
        a.hits.set(npc, res.enter);
        this.world.blood.spray(res.enter.point, res.enter.normal.add(dir.scale(-0.6)).normalize(), 1.5, arm.key === 'sword' ? 6 : 2, 0.4);
    }

    // --- hands: picking a body up and dragging it -------------------------------------------

    _take() {
        const { camera } = this.world;
        const eye = camera.globalPosition.clone(), ahead = camera.getDirection(V3.Forward());
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

    _hold(dt) {
        const g = this.grab;
        if (!g) return;
        const { camera } = this.world;
        const target = camera.globalPosition.add(camera.getDirection(V3.Forward()).scale(Math.min(g.distance, 2.2)));
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
        this.grab = null;
    }

    // --- throwing things ---------------------------------------------------------------------

    async _throw() {
        const { scene, camera, models, bodyOf } = this.world;
        const [name, mass] = THROWN[this.throwKind];
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
            blow(who.npc, e.point ?? who.seg.node.position, agg.body.getLinearVelocity().normalize(), mass, speed);
            this.world.sound?.shot('blunt', { at: (e.point ?? mesh.position).asArray(), gain: Math.min(1, speed / 10) });
        });
        this.thrown.push({ mesh, agg });
        if (this.thrown.length > 30) { const old = this.thrown.shift(); old.agg.dispose(); old.mesh.dispose(); }
    }

    get throwing() { return THROWN[this.throwKind][0].replace(/_\d+$/, '').replace(/_/g, ' '); }

    // --- every frame --------------------------------------------------------------------------

    update(dt) {
        this.busy = Math.max(0, this.busy - dt);
        if (this.reloading > 0 && (this.reloading -= dt) <= 0) this.ammo.set(this.arm.key, this.arm.gun.rounds);
        if (this.firing && this.arm.key === 'pistol' && this.busy <= 0) this.firing = false;
        if (this.action) {
            this._sweep(dt);
            if (this.action.t >= this.action.length) this.action = null;
        }
        this._hold(dt);
        // The flash goes as fast as it came.
        this.flash.intensity *= Math.exp(-dt * 40);
        if (this.flash.intensity < 1) { this.flash.intensity = 0; this.flashCard.setEnabled(false); }
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
