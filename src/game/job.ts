// One night's work: what the order asks for and how far it has got.
//
// The steps are the procedure as DESIGN.md has it, in the order a person
// would do them, and each is ticked by whatever place it is done in. The
// clipboard writes them out, and the next one is always in the corner of the screen.

import { MONTHS } from '../map/register.ts';

// Each: what it is called, and how it is written on the clipboard.
const STEPS = [
    ['tools', 'Get the spade and crowbar from the shed behind the chapel'],
    ['bier', 'Take the bier (the trolley) from beside the shed'],
    ['found', 'Find the grave'],
    ['dug', 'Dig down to the lid'],
    ['opened', 'Break open the lid'],
    ['checked', 'Check the body against the order'],
    ['lifted', 'Lift the body onto the bier'],
    ['inside', 'Wheel it to the cold room (the chapel\'s east door)'],
    ['taken', 'Take what is wanted'],
    ['handed', 'Hand it over'],
    ['home', 'Go home by the main gate'],
];

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

// A date as a person writes it: "Tuesday 2 December".
const written = ({ day, month, year }) => `${DAYS[new Date(Date.UTC(year, month, day)).getUTCDay()]} ${day} ${MONTHS[month]}`;

export class Job {
    declare night: any;
    declare done: Set<any>;
    declare checked: Set<any>;
    declare taken: any[];
    declare paid: number;

    // `night` is one of story.ts's NIGHTS.
    constructor(night) {
        this.night = night;
        this.done = new Set();
        this.checked = new Set();           // what on the order has been looked at (story.ts's checks)
        this.taken = [];                    // what is in the cooler: { name, grade }
        this.paid = 0;
    }

    get steps() { return STEPS.map(([name, says]) => ({ name, says: this._says(name, says), done: this.done.has(name) })); }

    // The first step not done.
    get next() { return STEPS.find(([name]) => !this.done.has(name))?.[0] ?? null; }

    // What the first step not done says, for the corner of the screen.
    get todo() { return this.steps.find((s) => !s.done)?.says ?? null; }

    tick(name) { this.done.add(name); }

    has(name) { return this.done.has(name); }

    see(check) {
        this.checked.add(check);
        if (this.night.order.check.every((c) => this.checked.has(c))) this.tick('checked');
    }

    // Into the cooler. `grade` is 'sound', 'marginal' or 'reject'.
    keep(name, grade) {
        this.taken.push({ name, grade });
        if (this.night.order.wanted.every((w) => this.taken.some((t) => t.name === w))) this.tick('taken');
    }

    // What is on the clipboard: the order as taken down, the work, the money. `run` is the Run.
    sheet(run) {
        const { night } = this, b = night.burial, order = night.order;
        const lines = b ? [
            `St Dymphna's, ${b.plot.replace(/^(\w)-(\d+)-(\d+)$/, 'section $1, row $2, no. $3')}`,
            `${b.forename} ${b.surname}, ${b.age}. Buried ${written(b.buried)}`,
            'Check: ' + order.check.map((c) => (this.checked.has(c) ? c.says + ' (seen)' : c.says)).join('; '),
        ] : [];
        const taken = this.taken.length ? ['In the cooler: ' + this.taken.map((t) => `${t.name} (${t.grade})`).join(', ')] : [];
        return {
            head: `${night.day} ${night.date} December`,
            order: lines,
            steps: (b ? this.steps : this.steps.filter((s) => ['handed', 'home'].includes(s.name))),
            foot: [...taken, `Owed £${run.debt.toLocaleString('en-GB')}.  In hand £${(run.money + this.paid).toLocaleString('en-GB')}.`],
        };
    }

    _says(name, says) {
        const { order } = this.night;
        if (name === 'taken') return 'Take: ' + order.wanted.join(', ');
        if (name === 'handed') return `${order.handover.place}, ${order.handover.time}`;
        return says;
    }
}
