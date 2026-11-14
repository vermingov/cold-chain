// A person's circulation, breathing and brain, second by second.
//
// Not a health bar. Blood is litres in a body and comes out of holes at a
// rate set by how big the hole is, whether an artery is in it, and how hard
// the heart is pushing; the heart speeds up as the blood runs out, then
// cannot keep the pressure up; a brain short of pressure or oxygen switches
// the person off in seconds and is gone in minutes. The figures are the
// textbook ones: about 70 ml of blood to a kilo, the four classes of
// haemorrhage, a cut carotid emptying a person in a minute or two.

const NORMAL = { hr: 72, map: 93, spo2: 98, rr: 14 };
const SETTLE = 2.5;             // seconds the heart rate and pressure take to follow what the body asks of them
const RESERVE = 10;             // seconds a brain stays awake with no blood reaching it
const BRAIN_DEATH = 300;        // seconds of no blood to the brain before it is gone for good
const COLLAPSE = 75;            // seconds a punctured lung takes to collapse

export type Bleed = { name: string; rate: number; arterial: boolean; internal: boolean; clots: number; lost: number; spurts?: boolean; source?: any; flow?: number; jet?: number;
    dressed?: number; dressing?: any };     // what a dressing over it leaves of its flow, and the dressing (dressing.ts)

export class Vitals {
    declare full: number;
    declare volume: number;
    declare bleeds: Bleed[];
    declare pump: number;
    declare rhythm: 'sinus' | 'fibrillating' | 'none';
    declare hr: number;
    declare map: number;
    declare spo2: number;
    declare rr: number;
    declare lungs: { L: number; R: number; leakL: boolean; leakR: boolean };
    declare airway: number;
    declare breathing: boolean;
    declare reserve: number;
    declare brainDamage: number;
    declare starved: number;
    declare _concussion: number;
    declare out: number;
    declare daze: number;
    declare pain: number;
    declare paralysed: { legs: boolean; arms: boolean };
    declare blind: { L: boolean; R: boolean };      // an eye that no longer sees (eyes.ts)
    declare injuries: { text: string; severity: number }[];
    declare dead: boolean;
    declare lowPressure: number;
    declare beat: number;
    declare onBeat: (() => void) | null;
    declare time: number;
    declare stopped: number;

    constructor(mass = 75) {
        this.full = 0.07 * mass;
        this.volume = this.full;
        this.bleeds = [];
        this.pump = 1;
        this.rhythm = 'sinus';
        this.hr = NORMAL.hr;
        this.map = NORMAL.map;
        this.spo2 = NORMAL.spo2;
        this.rr = NORMAL.rr;
        this.lungs = { L: 1, R: 1, leakL: false, leakR: false };
        this.airway = 1;
        this.breathing = true;
        this.reserve = 1;
        this.brainDamage = 0;
        this.starved = 0;
        this._concussion = 0;
        this.out = 0;              // seconds left knocked out
        this.daze = 0;             // 0 to 1: how muddled after a blow to the head, wearing off over minutes
        this.pain = 0;
        this.paralysed = { legs: false, arms: false };
        this.blind = { L: false, R: false };
        this.injuries = [];
        this.dead = false;
        this.lowPressure = 0;
        this.beat = 0;
        this.onBeat = null;
        this.time = 0;
        this.stopped = 0;          // seconds since the heart last beat
    }

    get lost() { return 1 - this.volume / this.full; }
    get beating() { return this.rhythm === 'sinus'; }
    // 1 awake and making sense, down to 0.
    get conscious() {
        if (this.dead || !this.beating) return Math.min(this.reserve, 0.3) * 0.5;
        const brain = this.brainDamage > 0.04 ? 0 : 1 - this.brainDamage * 10;
        const blood = Math.max(0, Math.min(1, (this.reserve - 0.15) / 0.55));
        const shock = this.lost > 0.38 ? Math.max(0, 1 - (this.lost - 0.38) / 0.08) : 1;
        const knocked = this.out > 0 ? 0.12 : 1 - this.daze * 0.45;
        return Math.max(0, Math.min(brain, blood, shock, knocked));
    }
    get systolic() { return Math.round(this.map * 1.32); }
    get diastolic() { return Math.round(this.map * 0.84); }

    // What a person in this state is, in a word or two.
    get state() {
        if (this.dead) return 'Dead';
        if (!this.beating) return this.rhythm === 'fibrillating' ? 'Cardiac arrest (fibrillating)' : 'Cardiac arrest';
        if (!this.breathing) return 'Not breathing';
        const c = this.conscious;
        return c < 0.35 ? 'Unconscious' : c < 0.75 ? 'Confused' : this.pain > 0.5 ? 'Conscious, in pain' : 'Conscious';
    }

    // How hard the brain has been shaken by blows to the head, 0 to 1. Only blows to the head add to it. Each blow is
    // judged as it lands: a hard one knocks a person out for seconds to a minute or so, and they come round muddled;
    // a lighter one only dazes them. A knockout is a chance, not a certainty, and it does not come from a body blow
    // at all (dev/research/blunt-trauma.md: concussion follows the head's rotational acceleration, a punch is near the
    // threshold, a full bat swing well over it).
    get concussion() { return this._concussion; }
    set concussion(value: number) {
        const blow = value - this._concussion;
        this._concussion = Math.max(0, Math.min(1, value));
        if (blow <= 0) return;
        const chance = Math.max(0, Math.min(1, (blow - 0.22) / 0.45));
        if (Math.random() < chance) this.out = Math.max(this.out, 4 + blow * 70 * (0.5 + Math.random()));
        this.daze = Math.min(1, this.daze + blow * 0.8);
        if (this.out > 0) {
            this.injuries = this.injuries.filter((i) => i.text !== 'Dazed by a blow to the head');
            this.injure('Knocked out by a blow to the head', 6);
        } else if (blow > 0.15 && !this.injuries.some((i) => i.text.startsWith('Knocked out'))) this.injure('Dazed by a blow to the head', 3);
    }

    bleed(b: Partial<Bleed> & { name: string; rate: number }) {
        const full = { arterial: false, internal: false, clots: 0.01, lost: 0, ...b };
        this.bleeds.push(full);
        return full;
    }

    injure(text: string, severity: number) {
        if (!this.injuries.some((i) => i.text === text)) this.injuries.push({ text, severity });
        this.injuries.sort((a, b) => b.severity - a.severity);
    }

    // The heart stops, or never starts again.
    arrest(rhythm: 'fibrillating' | 'none' = 'fibrillating') {
        if (this.rhythm === 'sinus') this.rhythm = rhythm;
    }

    update(dt: number) {
        this.time += dt;
        const f = this.volume / this.full;
        // --- the heart and the pressure it makes
        const preload = Math.pow(Math.max(0, Math.min(1, (f - 0.4) / 0.6)), 0.8);
        if (this.beating) {
            const fear = Math.min(1, this.pain) * 18;
            const want = Math.min(170, NORMAL.hr + 95 * Math.min(1, (1 - f) / 0.33) + fear);
            // Past what can be made up for, the heart slows and stops.
            const hr = f < 0.5 ? want * Math.max(0.35, (f - 0.4) / 0.1) : want;
            this.hr += (hr - this.hr) * Math.min(1, dt / SETTLE);
            const squeeze = 1 + 0.22 * Math.min(1, (1 - f) / 0.3);
            const map = NORMAL.map * preload * this.pump * Math.min(1.15, Math.sqrt(this.hr / NORMAL.hr)) * squeeze * (0.4 + 0.6 * Math.min(1, this.spo2 / 85));
            this.map += (map - this.map) * Math.min(1, dt / SETTLE);
            this.lowPressure = this.map < 28 ? this.lowPressure + dt : 0;
            if (this.lowPressure > 4 || f < 0.42 || this.pump < 0.15 || this.spo2 < 35) this.arrest(this.pump < 0.15 || this.spo2 < 35 ? 'fibrillating' : 'none');
            this.beat += dt * this.hr / 60;
            if (this.beat >= 1) { this.beat -= 1; this.onBeat?.(); }
        } else {
            this.hr += (0 - this.hr) * Math.min(1, dt * 3);
            this.map += (6 - this.map) * Math.min(1, dt / 4);
            this.stopped += dt;
            // Fibrillation runs down to nothing in a few minutes without a shock.
            if (this.stopped > 180 && this.rhythm === 'fibrillating') this.rhythm = 'none';
        }

        // --- blood out
        let out = 0;
        // With the heart stopped a wound still drains, by its own weight, slower and slower as the blood settles and
        // clots: a dead man shot in the head still bleeds onto the floor.
        const drains = this.beating ? 0 : 0.2 * Math.exp(-this.stopped / 300);
        for (const b of this.bleeds) {
            const push = Math.max(Math.pow(Math.max(0, this.map) / NORMAL.map, b.arterial ? 1 : 0.6), b.internal ? 0 : drains);
            b.flow = b.rate * push * (b.dressed ?? 1);
            const lost = b.flow * dt;
            b.lost += lost;
            out += lost;
            b.rate *= Math.exp(-b.clots * dt * (b.arterial ? 0.15 : 1));
        }
        this.volume = Math.max(0, this.volume - out);

        // --- breathing and oxygen
        for (const side of ['L', 'R'] as const) {
            if (this.lungs[`leak${side}`]) this.lungs[side] = Math.max(0.05, this.lungs[side] - dt / COLLAPSE);
        }
        const air = this.breathing ? ((this.lungs.L + this.lungs.R) / 2) * this.airway : 0;
        this.rr = this.breathing && this.beating ? NORMAL.rr + 16 * Math.min(1, (1 - f) / 0.35) + 10 * (1 - air) : 0;
        const spo2 = air > 0 && this.beating ? 70 + 28 * Math.sqrt(air) : 20;
        this.spo2 += (spo2 - this.spo2) * Math.min(1, dt / (spo2 < this.spo2 ? 25 : 6));

        // --- the brain
        const reaching = Math.max(0, Math.min(1, (this.map - 25) / 40)) * Math.max(0, Math.min(1, (this.spo2 - 50) / 40));
        if (reaching < 0.5) this.reserve = Math.max(0, this.reserve - dt / RESERVE * (1 - reaching * 2));
        else this.reserve = Math.min(1, this.reserve + dt / 20);
        this.starved = this.reserve <= 0.05 ? this.starved + dt : Math.max(0, this.starved - dt * 0.2);
        this._concussion = Math.max(0, this._concussion - dt / 40);
        this.out = Math.max(0, this.out - dt);
        this.daze = Math.max(0, this.daze - dt / 240);
        this.pain = Math.max(0, this.pain - dt / 90);
        if (this.starved > BRAIN_DEATH || this.brainDamage > 0.25) this.dead = true;
        if (this.dead) { this.rhythm = this.rhythm === 'sinus' ? 'none' : this.rhythm; this.breathing = false; }
    }
}
