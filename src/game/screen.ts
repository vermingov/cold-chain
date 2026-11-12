// What is put over the picture: words being said, the card between places,
// the dark the picture fades into, and the one word that says what the
// hand would do with the thing in the middle of the eye.
//
// It is all on one layer of the page over the canvas, in the type the stones
// are cut in. There is no other interface: what has to be known is on the
// clipboard (clipboard.js), in the player's own hands.

// How long a line stays up: a breath before it, then as long as a person
// takes to say it, at a slow and careful pace.
const SAID = { before: 0.35, perWord: 0.34, least: 1.6, after: 0.25 };
const FADE = 0.9;           // seconds the picture takes to go dark or come back
const PASS = 0.8;           // seconds Space is held down to pass over the rest of what is being said

export class Screen {
    declare layer: any;
    declare dark: HTMLDivElement;
    declare card: HTMLDivElement;
    declare words: HTMLDivElement;
    declare aim: HTMLDivElement;
    declare verb: HTMLDivElement;
    declare held: HTMLDivElement;
    declare faults: HTMLDivElement;
    declare version: HTMLDivElement;
    declare todo: HTMLDivElement;
    declare how: HTMLDivElement;
    declare breath: HTMLDivElement;
    declare marker: HTMLDivElement;
    declare seen: Set<any>;
    declare skipping: (() => void) | (() => void);
    declare speaking: boolean;
    declare passed: boolean;
    declare pressed: number;
    declare recorded: { manifest: any; base: string; };

    // `layer` is an element laid over the canvas.
    constructor(layer) {
        this.layer = layer;
        this.dark = add(layer, 'dark');
        this.card = add(layer, 'card');
        this.words = add(layer, 'words');
        this.aim = add(layer, 'aim');
        this.verb = add(layer, 'verb');
        // (Under the words: how far along a held Space is to passing over them.)
        this.held = add(layer, 'held');
        // (In a corner: what went wrong, if anything did, for whoever is playing to pass on.)
        this.faults = add(layer, 'fault');
        // (Top left: which build this is, and what the night's work wants doing next.)
        this.version = add(layer, 'version shown');
        this.version.textContent = `Cold Chain ${__VERSION__}`;
        this.todo = add(layer, 'todo');
        this.how = add(layer, 'how');
        // (Low in the middle: how much breath is left, while any has been spent.)
        this.breath = add(layer, 'breath');
        // (Over a place in the picture: where something is to go.)
        this.marker = add(layer, 'marker');
        this.seen = new Set();
        this.skipping = null;
        this.speaking = false;          // whether lines are being said just now
        this.passed = false;            // whether the rest of what is being said is to be passed over
        // Space tapped hurries on to the next line; held down, it passes over everything still to be said.
        window.addEventListener('keydown', (e) => {
            if (e.code !== 'Space' || e.repeat || !this.speaking) return;
            this.pressed = performance.now();
            this._holding();
        });
        window.addEventListener('keyup', (e) => {
            if (e.code !== 'Space' || this.pressed === null) return;
            this.pressed = null;
            this.held.style.transform = 'scaleX(0)';
            if (!this.passed && this.skipping) this.skipping();
        });
        this.pressed = null;
    }

    // While Space is down: the line under the words fills, and when it is full what is left of the talk is passed over.
    _holding() {
        if (this.pressed === null || !this.speaking) return;
        const full = Math.min(1, (performance.now() - this.pressed) / 1000 / PASS);
        this.held.style.transform = `scaleX(${full})`;
        if (full < 1) {
            requestAnimationFrame(() => this._holding());
            return;
        }
        this.passed = true;
        this.held.style.transform = 'scaleX(0)';
        if (this.skipping) this.skipping();
    }

    // Recorded lines (tools/voices.py): `manifest` maps a line's text to its file under `base`.
    hear(manifest, base = 'assets/voices/') {
        this.recorded = { manifest, base };
    }

    // Say the lines one after another ({ who, says }, `voices` naming who). A line that was recorded is heard and
    // shown for as long as it takes; one that was not is shown for as long as it would take to say. Resolves when
    // the last is gone.
    async say(lines, voices) {
        this.speaking = true;
        for (const { who, says } of lines) {
            if (this.passed) break;
            await this._hold(SAID.before);
            this.words.replaceChildren(text('who', voices[who] || who), text('says', says));
            this.words.classList.add('shown');
            const file = this.recorded?.manifest[says];
            if (file) await this._play(this.recorded.base + file);
            else await this._hold(Math.max(SAID.least, says.split(/\s+/).length * SAID.perWord), true);
            this.words.classList.remove('shown');
            if (!this.passed) await this._hold(SAID.after);
        }
        this.speaking = false;
        this.passed = false;
    }

    // Play a recorded line through; Space cuts it short.
    _play(url) {
        const voice = new Audio(url);
        return new Promise<void>((done) => {
            const finish = () => {
                voice.pause();
                if (this.skipping === finish) this.skipping = null;
                done();
            };
            voice.addEventListener('ended', finish, { once: true });
            voice.addEventListener('error', finish, { once: true });
            this.skipping = finish;
            voice.play().catch(finish);
        });
    }

    // A thought or a thing noticed: the same place as speech, said by nobody.
    async note(says) { await this.say([{ who: '', says }], {}); }

    // The picture goes dark, `then` runs, and it comes back. A card may be shown in the dark meanwhile.
    async through(then, { card = null, hold = 1.6 } = {}) {
        await this.fade(true);
        if (card) {
            this.card.replaceChildren(...card.map((line, i) => text(i ? 'line' : 'head', line)));
            this.card.classList.add('shown');
        }
        const [result] = await Promise.all([then(), this._hold(card ? hold : 0)]);
        this.card.classList.remove('shown');
        await this._hold(card ? FADE * 0.6 : 0);
        await this.fade(false);
        return result;
    }

    fade(dark) {
        this.dark.classList.toggle('shown', dark);
        return this._hold(FADE);
    }

    // Something went wrong in the game: said once in the corner, and in the console in full.
    fault(error) {
        const said = String((error && error.message) || error).slice(0, 160);
        if (this.seen.has(said)) return;
        this.seen.add(said);
        console.error(error);
        this.faults.textContent = `Fault: ${said}`;
        this.faults.classList.add('shown');
    }

    // The next thing to do, or null for nothing; and, under it, how the controls for it go.
    task(says, how = null) {
        for (const [el, words] of [[this.todo, says], [this.how, how]]) {
            el.classList.toggle('shown', !!words);
            if (words && el.textContent !== words) el.textContent = words;
        }
    }

    // How much breath is left, 0 to 1; shown only while it is not full.
    winded(left) {
        this.breath.classList.toggle('shown', left < 0.995);
        this.breath.style.transform = `scaleX(${left.toFixed(3)})`;
    }

    // A word over a point of the screen, [x, y] in CSS pixels, or null for none.
    mark(at, words = '') {
        this.marker.classList.toggle('shown', !!at);
        if (!at) return;
        if (this.marker.textContent !== words) this.marker.textContent = words;
        this.marker.style.left = `${at[0].toFixed(0)}px`;
        this.marker.style.top = `${at[1].toFixed(0)}px`;
    }

    // What the hand would do with what is in the middle of the eye, or null for nothing.
    hint(verb) {
        this.aim.classList.toggle('shown', !!verb);
        if (this.verb.textContent !== (verb || '')) this.verb.textContent = verb || '';
    }

    _hold(seconds, skippable = false) {
        return new Promise<void>((done) => {
            const finish = () => {
                clearTimeout(timer);
                if (this.skipping === finish) this.skipping = null;
                done();
            };
            const timer = setTimeout(finish, seconds * 1000);
            if (skippable) this.skipping = finish;
        });
    }
}

function add(parent, name) {
    const el = document.createElement('div');
    el.className = name;
    parent.append(el);
    return el;
}

function text(name, words) {
    const el = document.createElement('span');
    el.className = name;
    el.textContent = words;
    return el;
}
