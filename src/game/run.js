// What carries from one night to the next: which night it is, the money,
// what is owed, and what has been done that the story remembers.
//
// Kept in the browser's own storage at the start of every night, so a night
// that goes wrong is played again from its call, not from the first one.

import { OWED } from './story.js';

const KEY = 'cold-chain.run';

export class Run {
    constructor(saved = {}) {
        this.night = saved.night ?? 1;
        this.money = saved.money ?? 0;                          // pounds in hand
        this.owed = saved.owed ?? OWED.map((o) => ({ ...o }));
        this.marks = saved.marks ?? {};                         // what the story remembers: { name: value }
    }

    static load() {
        const saved = localStorage.getItem(KEY);
        return new Run(saved ? JSON.parse(saved) : {});
    }

    save() { localStorage.setItem(KEY, JSON.stringify(this)); }

    static forget() { localStorage.removeItem(KEY); }

    get debt() { return this.owed.reduce((sum, o) => sum + o.pounds, 0); }

    // Money paid at a gate, and a night closed.
    paid(pounds) { this.money += pounds; }
}
