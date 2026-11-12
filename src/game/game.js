// The game: the nights, one after another, and the places each is played in.
//
// A night is a call taken in the flat, the work in the yard and on the
// table, the handover at the gate, and the flat again in the morning. Each
// place is a scene of its own on the one engine; going from one to the
// next is done in the dark, with the time on a card. The yard is kept while
// the table is visited, so a grave left open is still open on the way back.

import { NIGHTS, VOICES } from './story.js';
import { Run } from './run.js';
import { Job } from './job.js';
import { openFlat } from './flat.js';
import { openYard } from './yard/place.js';
import { Noises } from './noises.js';

const pad = (n) => String(n).padStart(2, '0');

export class Game {
    constructor(engine, canvas, screen) {
        this.engine = engine;
        this.canvas = canvas;
        this.screen = screen;
        this.run = Run.load();
        this.place = null;          // what is being drawn and played: { scene, update(dt), clipboard, dispose() }
        this.noises = null;         // the sounds outside the table (noises.js), once the page may sound
        window.addEventListener('keydown', (e) => {
            if (e.code !== 'Tab' || !this.place || !this.place.clipboard) return;
            e.preventDefault();
            this.place.clipboard.toggle();
            if (this.place.clipboard.up) this.place.clipboard.write(this.job.sheet(this.run));
        });
        engine.runRenderLoop(() => {
            if (!this.place) return;
            // A frame that throws is shown and drawn past, so that one fault is not the end of the night.
            try {
                // Never more than a twentieth of a second at once: a stalled frame must not carry anybody through a wall.
                this.place.update(Math.min(0.05, engine.getDeltaTime() / 1000));
                this.place.scene.render();
                this.noises?.update();
            } catch (error) {
                screen.fault(error);
            }
        });
        window.addEventListener('error', (e) => screen.fault(e.error || e.message));
        window.addEventListener('unhandledrejection', (e) => screen.fault(e.reason));
    }

    // Only the first night is built: it is played from its call, whatever was saved. Called on the click that
    // begins the game, so that the sound may start.
    async play() {
        const noises = Noises.open();
        await document.fonts.load('italic 40px Fell');
        this.noises = await noises;
        this.screen.hear(await (await fetch('assets/voices/manifest.json')).json());
        this.run = new Run();
        this.run.save();
        await this.night(NIGHTS[0]);
        this.run.night = 2;
        this.run.save();
        await this.screen.through(async () => this._leave(), { card: ['That is as far as it goes for now.', 'Friday night is not built yet.'], hold: 3600 });
    }

    // One night, from the call to the morning.
    async night(night) {
        this.job = new Job(night);
        const { day, date, clock: [h, m] } = night;
        const flat = await this._go(() => openFlat(this.engine, this.canvas, { screen: this.screen, noises: this.noises }), [`${day} ${date} December`, `${pad(h)}:${pad(m)}`]);
        await this._evening(flat, night);
        const yard = await this._go(() => openYard(this.engine, this.canvas, this), ['St Dymphna\'s', 'Vicarage Road']);
        await yard.night;
        const morning = await this._go(() => openFlat(this.engine, this.canvas, { screen: this.screen, noises: this.noises, morning: true }),
            [`${NIGHTS[night.id]?.day ?? 'Friday'} morning`, '07:40']);
        await this._morning(morning, night);
    }

    // Draw another place instead, in the dark. `open` builds it; `card` is shown while it does.
    async _go(open, card) {
        return this.screen.through(async () => {
            this._leave();
            this.place = await open();
            return this.place;
        }, { card });
    }

    // From the yard to the table and back: the yard is kept and only the table is built.
    async visit(open, card) {
        const yard = this.place;
        this.place = null;
        yard.pause?.();
        const table = await this.screen.through(async () => (this.place = await open()), { card });
        await table.done;
        await this.screen.through(async () => {
            table.dispose();
            this.place = yard;
            yard.resume?.();
        });
    }

    _leave() {
        this.noises?.hush();
        if (this.place) this.place.dispose();
        this.place = null;
    }

    // The flat in the evening: the messages, the call, the door.
    async _evening(flat, night) {
        const { things } = flat, screen = this.screen, noises = this.noises;
        let heard = false, called = false;
        const machine = things.add({
            at: flat.devices.machineAt, reach: 1.6,
            verb: () => (heard ? null : 'Play the messages'),
            use: async () => {
                flat.devices.blinking = false;
                noises.shot('beep');
                await screen.say(night.machine, VOICES);
                noises.shot('beep');
                heard = true;
                noises.ring(true);
                await screen.note('The phone goes.');
            },
        });
        await new Promise((answered) => {
            things.add({
                at: flat.devices.phoneAt, reach: 1.6,
                verb: () => (heard && !called ? 'Answer it' : null),
                use: async () => {
                    noises.ring(false);
                    noises.shot('handset');
                    await screen.say(night.call, VOICES);
                    noises.shot('handset', 0.8);
                    called = true;
                    things.remove(machine);
                    await screen.note('The order is on the clipboard. Tab to look at it.');
                    answered();
                },
            });
        });
        await this._door(flat, 'Go out');
    }

    // The flat in the morning: what was paid, what is still owed, and whatever is on the machine.
    async _morning(flat, night) {
        const paid = this.job.paid;
        this.run.paid(paid);
        if (night.morning.length) {
            flat.devices.blinking = true;
            await new Promise((heard) => flat.things.add({
                at: flat.devices.machineAt, reach: 1.6,
                verb: () => 'Play the messages',
                use: async () => {
                    flat.devices.blinking = false;
                    this.noises.shot('beep');
                    await this.screen.say(night.morning, VOICES);
                    heard();
                },
            }));
        }
        await this.screen.note(paid ? `£${paid.toLocaleString('en-GB')} on the table. It is not enough. It is never going to be enough.`
            : 'Nothing on the table. Nothing for the clinic.');
        await new Promise((out) => flat.things.add({ at: flat.sofa, reach: 2, wide: 2, verb: () => 'Lie down', use: out }));
    }

    _door(flat, verb) {
        return new Promise((out) => flat.things.add({
            at: flat.door, reach: 1.5, wide: 2, verb: () => verb,
            use: async () => {
                this.noises.shot('door');
                await flat.open();
                out();
            },
        }));
    }
}
