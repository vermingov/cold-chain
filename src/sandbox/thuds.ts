// A body meeting something: the sound of it, from Havok's own contacts as they begin (not every step they last), and a
// hard slam into something standing (a wall, a pillar, a crate's side) taken as a blunt blow. Landings on what is under
// them are bones.ts's (_falls), so a contact from below is only heard here.

import * as BABYLON from '@babylonjs/core';
import { blow } from './wounds.ts';

const V3 = BABYLON.Vector3;
const HEARD = 1.2;          // m/s: the least speed lost against something that is heard
const HURTS = 3;            // m/s: the least speed lost against something standing that bruises or breaks
const AGAIN = 0.15;         // s: the least time between two sounds from one segment (a body rolling is not a drum roll)
const LYING = 0.2;          // m: a segment whose middle is this near the floor lies on it (a trunk's is 10 to 15 cm up)

export class Thuds {
    declare world: any;
    declare started: number;
    declare last: WeakMap<any, number>;
    declare dragging: any;

    constructor(world, physics: BABYLON.HavokPlugin) {
        this.world = world;
        this.started = (physics as any)._hknp.EventType.COLLISION_STARTED.value;
        this.last = new WeakMap();
        physics.onCollisionObservable.add((e) => this._met(e));
        world.scene.onBeforeRenderObservable.add(() => this._drag());
        this._mask = (body) => (physics as any)._hknp.HP_Body_SetEventMask(body._pluginData.hpBodyId, this.started);
    }
    declare _mask: (body) => void;

    // Person `npc`'s segments report contacts as they begin (only then: a body at rest touches the floor every step).
    listen(npc) {
        for (const seg of npc.ragdoll.segments) this._mask(seg.body);
    }

    _met(e: BABYLON.IPhysicsCollisionEvent) {
        if (e.type !== BABYLON.PhysicsEventType.COLLISION_STARTED || !e.point) return;
        const { bodyOf, sound, frame } = this.world;
        const a = bodyOf.get(e.collider), b = bodyOf.get(e.collidedAgainst);
        for (const [who, other] of [[a, b], [b, a]]) {
            if (!who) continue;
            const { npc, seg } = who;
            // A segment's own neighbours meet all the time as it moves: only a hard one is heard.
            const own = other?.npc === npc;
            const speed = e.impulse / Math.max(0.3, seg.mass);
            if (speed < (own ? HEARD * 2 : HEARD)) continue;
            const now = frame / 60;
            if (now - (this.last.get(seg) ?? -1) < AGAIN) continue;
            this.last.set(seg, now);
            const base = seg.name.replace(/2?[LR]$/, ''), loud = Math.min(1, (speed - HEARD * 0.5) / 6);
            const trunk = base === 'pelvis' || base === 'belly' || base === 'chest';
            // Into something standing (a wall, a pillar, a crate's side), not a person and not from below.
            const into = V3.TransformCoordinates(seg.centre, seg.node.getWorldMatrix()).subtract(e.point);
            const side = !other && Math.abs(into.normalize().y) < 0.6;
            // A head knocks on the floor or a wall (on a person it is a blow); a trunk slams into a wall or falls; a limb
            // slaps (a soft one sometimes only lands), or a fast one hits as hard as a blow.
            const take = base === 'head' ? (other ? 'blunt' : 'head-hit') : trunk ? (side ? 'body-slam' : 'body-fall')
                : speed > 3.5 ? 'blunt' : speed < 2.5 && Math.random() < 0.4 ? 'lay' : 'limb-slap';
            sound?.shot(take, { at: e.point.asArray(), gain: trunk ? loud : loud * 0.8 });
            // Into something standing, hard: the wall gives nothing and the part takes it as a blow. (From below is a
            // landing: bones.ts counts those.)
            if (side && speed > HURTS) blow(npc, e.point, into, seg.mass, speed);
        }
    }

    // A person taken hold of and pulled (weapons.ts _hold): what of them lies on the floor is heard sliding on it, from
    // where it is, as loud as it slides fast; silent once it stops or is let go.
    _drag() {
        const { sound, weapons, ground } = this.world, npc = weapons?.grab?.npc;
        if (!sound) return;
        let slid = 0, mass = 0;
        const at = new V3(0, 0, 0);
        for (const seg of npc?.ragdoll.segments ?? []) {
            const c = V3.TransformCoordinates(seg.centre, seg.node.getWorldMatrix());
            if (c.y - ground(c.x, c.z, c.y + 0.05) > LYING) continue;
            const v = seg.body.getLinearVelocity();
            slid += Math.hypot(v.x, v.z) * seg.mass;
            mass += seg.mass;
            at.addInPlace(c.scaleInPlace(seg.mass));
        }
        const speed = mass > 5 ? slid / mass : 0;
        if (speed > 0.1) (this.dragging ??= sound.stream('drag', at.scale(1 / mass).asArray())).at(at.scale(1 / mass).asArray());
        this.dragging?.drive(speed > 0.1 ? Math.min(1, speed / 1.5) * 0.8 : 0);
    }
}
