// The burial register: who lies in every taken plot.
//
// The cemetery's own book. The Registrar reads orders out of it, the stones
// are cut from it, and it is the one place that says who a body ought to
// be: which is the thing the player checks before lifting anybody.
//
// It is made up, from a seed, to suit the ground each plot is in: the old
// ground filled in Victoria's reign, the lawns after the war, the public
// graves and the meadow in the last few years.
//
// Nothing here knows about the engine.

import { makeRng } from '../rng.ts';
import { plots } from './plan.ts';

const SURNAMES = ['Ainsley', 'Alcock', 'Bamford', 'Barraclough', 'Beech', 'Birtles', 'Booth', 'Bradbury', 'Brierley', 'Broadbent',
    'Calvert', 'Chadwick', 'Clegg', 'Crabtree', 'Dearden', 'Dyson', 'Eastwood', 'Fenton', 'Firth', 'Garside',
    'Greaves', 'Hague', 'Hallam', 'Hartley', 'Haigh', 'Hobbs', 'Holroyd', 'Ibbotson', 'Jagger', 'Kershaw',
    'Lumb', 'Marsden', 'Mellor', 'Moorhouse', 'Naylor', 'Oldroyd', 'Parr', 'Pickles', 'Platt', 'Rawson',
    'Redfern', 'Rigby', 'Schofield', 'Shaw', 'Sykes', 'Tattersall', 'Thorp', 'Varley', 'Wadsworth', 'Whiteley',
    'Wilde', 'Womersley', 'Yates', 'Ogden', 'Pogson', 'Quarmby', 'Stott', 'Hirst', 'Kaye', 'Dransfield'];

// What people were called, by when they were born.
const FORENAMES = [
    { before: 1900, names: ['Albert', 'Walter', 'Herbert', 'Ernest', 'Arthur', 'Joseph', 'Enoch', 'Seth', 'Amos', 'Wilfred',
        'Ada', 'Edith', 'Florence', 'Hannah', 'Martha', 'Sarah', 'Eliza', 'Alice', 'Fanny', 'Emily', 'Harriet', 'Ellen'] },
    { before: 1945, names: ['Ronald', 'Kenneth', 'Stanley', 'Harold', 'Norman', 'Cyril', 'Leslie', 'Frank', 'Eric', 'Dennis',
        'Doreen', 'Joyce', 'Marjorie', 'Edna', 'Vera', 'Hilda', 'Phyllis', 'Irene', 'Winifred', 'Mavis', 'Nora', 'Elsie'] },
    { before: 1975, names: ['Brian', 'Keith', 'Trevor', 'Malcolm', 'Graham', 'Derek', 'Alan', 'Barry', 'Roy', 'Geoffrey',
        'Susan', 'Carol', 'Maureen', 'Pauline', 'Janet', 'Christine', 'Sheila', 'Brenda', 'Valerie', 'Linda', 'Glenys', 'June'] },
    { before: Infinity, names: ['Darren', 'Lee', 'Craig', 'Wayne', 'Dean', 'Gary', 'Shaun', 'Karl', 'Jason', 'Scott',
        'Tracey', 'Sharon', 'Michelle', 'Donna', 'Joanne', 'Kerry', 'Lisa', 'Mandy', 'Gemma', 'Stacey', 'Kelly', 'Dawn'] },
];

// When each ground was being filled: the years people in it died.
const FILLED = { victorian: [1851, 1912], postwar: [1946, 1978], lawn: [1979, 2019], public: [2019, 2025], meadow: [2016, 2025] };
export const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

// How old somebody was. The old ground is full of children; nobody is put
// in a public grave young any more.
function ageAt(rng, era) {
    if (era === 'victorian' && rng.chance(0.22)) return rng.int(6);
    if (era === 'victorian') return 19 + rng.int(62);
    return 48 + rng.int(46);
}

// Everybody buried here, by plot id: { plot, forename, surname, born, died:
// { day, month, year }, age }.
export function register(seed = 1887) {
    const rng = makeRng(seed * 31 + 7);
    const people = new Map();
    for (const plot of plots()) {
        if (!plot.taken) continue;
        const [from, to] = FILLED[plot.era];
        const year = from + rng.int(to - from + 1), age = ageAt(rng, plot.era), born = year - age;
        people.set(plot.id, {
            plot: plot.id,
            forename: rng.pick(FORENAMES.find((f) => born < f.before).names),
            surname: rng.pick(SURNAMES),
            born, age,
            died: { day: 1 + rng.int(28), month: rng.int(12), year },
        });
    }
    return people;
}
