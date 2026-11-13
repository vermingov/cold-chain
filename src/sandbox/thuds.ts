// A body meeting something: the sound of it, from Havok's own contacts as they begin (not every step they last), and a
// hard slam into something standing (a wall, a pillar, a crate's side) taken as a blunt blow. Landings on what is under
// them are bones.ts's (_falls), so a contact from below is only heard here.

import * as BABYLON from '@babylonjs/core';
import { blow } from './wounds.ts';

const V3 = BABYLON.Vector3;
const HEARD = 1.2;          // m/s: the least speed lost against something that is heard
const HURTS = 3;            // m/s: the least speed lost against something standing that bruises or breaks
const AGAIN = 0.15;         // s: the least time between two sounds from one segment (a body rolling is not a drum roll)

export class Thuds {
    declare world: any;
    declare started: number;
    declare last: WeakMap<any, number>;

    constructor(world, physics: BABYLON.HavokPlugin) {
        this.world = world;
        this.started = (physics as any)._hknp.EventType.COLLISION_STARTED.value;
        this.last = new WeakMap();
        physics.onCollisionObservable.add((e) => this._met(e));
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
            const take = trunk ? 'body-fall' : base === 'head' || speed > 3.5 ? 'blunt' : 'lay';
            sound?.shot(take, { at: e.point.asArray(), gain: trunk ? loud : loud * 0.8, rate: base === 'head' ? 1.1 : 1 });
            // Into something standing, hard: the wall gives nothing and the part takes it as a blow. (From below is a
            // landing: bones.ts counts those.)
            const into = V3.TransformCoordinates(seg.centre, seg.node.getWorldMatrix()).subtract(e.point);
            if (!other && speed > HURTS && Math.abs(into.normalize().y) < 0.6) blow(npc, e.point, into, seg.mass, speed);
        }
    }
}
