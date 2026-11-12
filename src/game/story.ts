// The story: five nights, as they are told.
//
// Everything said, written or found in the game is here and nowhere else:
// what is on the answering machine, the Registrar's calls, the orders, what
// the buyers say at the gate, the post in the morning. The places (yard,
// table, flat) only play it. Nothing here knows about the engine.
//
// A line is { who, says }. Nobody is voiced yet: the lines are shown as they
// are said, timed to how long a person would take to say them. The player
// says nothing; the Registrar's pauses are where they would have.
//
// The facts the story stands on are DESIGN.md's. Dates are December 2025:
// cold ground, short days.

export const YEAR = 2025;
export const MONTH = 11;             // December, counted from nought as the register counts

// Who speaks, as the words are shown.
export const VOICES = {
    registrar: 'The Registrar',
    elin: 'Elin',
    unit: 'The renal unit',
    landlord: 'Mr Firth',
    buyer: 'The buyer',
    driver: 'The driver',
    sexton: 'The sexton',
    machine: 'The machine',
};

// What a thing taken out of somebody fetches, by how it came out: sound,
// marginal (marked, handled, a nick in it) or reject (torn, cut through,
// spoiled). Pounds, cash, counted at the gate.
export const PRICES = {
    kidney: { sound: 1150, marginal: 480, reject: 0 },
};

// What is owed when the game starts, and to whom. The clinic's deposit is
// what the money is for; the rest is what keeps getting in the way of it.
export const OWED = [
    { to: 'Mr Firth, the flat', pounds: 1140 },
    { to: 'Dr Anand, Holbeck Clinic: the deposit', pounds: 6000 },
];

export const NIGHTS = [
    {
        id: 1,
        day: 'Thursday',
        date: 4,
        clock: [23, 10],
        // Who is in the ground, as the register now says: buried on Tuesday by the council, nobody at the graveside.
        burial: {
            plot: 'E-7-10', forename: 'Harold', surname: 'Thorp', born: 1947, age: 78,
            died: { day: 27, month: 10, year: YEAR }, buried: { day: 2, month: 11, year: YEAR },
            plate: 'HAROLD THORP  1947 - 2025',
            body: 'oldman',
        },
        // What is found when the lid comes off, against what the order says. Night one, they agree.
        found: { plate: 'HAROLD THORP  1947 - 2025', matches: true },
        order: {
            wanted: ['left kidney', 'right kidney'],
            check: [
                { says: 'Name plate on the lid', look: 'plate', verb: 'Read the plate', seen: 'Harold Thorp, 1947 to 2025. Brass, already going green.' },
                { says: 'Appendix scar, low on the right', look: 'belly', verb: 'Open his shirt', seen: 'An old white scar, low on the right of his belly. Appendix.' },
                { says: 'Ring on the left hand', look: 'hands', verb: 'Look at his hands', seen: 'A thin gold ring, worn into the finger of his left hand.' },
            ],
            handover: { place: 'The service gate, east wall', time: '03:30' },
        },
        machine: [
            { who: 'machine', says: 'You have two new messages. First new message.' },
            { who: 'elin', says: 'Hiya. It\'s me. They had me on for four hours again because the line kept alarming.' },
            { who: 'elin', says: 'The arm\'s gone a funny colour round the fistula. The nurse says it\'s fine. She said it like it isn\'t.' },
            { who: 'elin', says: 'Don\'t ring back tonight, I\'m knackered. Love you. Eat something.' },
            { who: 'machine', says: 'Next new message.' },
            { who: 'unit', says: 'This is Joanne from Holbeck Clinic for Dr Anand. We still haven\'t received the deposit for Miss Elin\'s assessment.' },
            { who: 'unit', says: 'The slot is held until the nineteenth. After that it goes to the next family. Please do call us.' },
            { who: 'machine', says: 'End of messages.' },
        ],
        call: [
            { who: 'registrar', says: 'You\'re in. Good. Have you something to write with.' },
            { who: 'registrar', says: 'St Dymphna\'s. Vicarage Road. The public ground at the top, past the chapel. Section E, row seven, number ten.' },
            { who: 'registrar', says: 'Harold Thorp. Seventy-eight. Council funeral on Tuesday, nobody came. No embalming, they don\'t pay for it.' },
            { who: 'registrar', says: 'Both kidneys. Lift them whole, with as much of the tubes as you can. A nick in one and it is worth half.' },
            { who: 'registrar', says: 'Check him before you lift him. The plate, the scar on his belly, the ring. The ground up there gets reused.' },
            { who: 'registrar', says: 'The tools are in the store behind the chapel. The cold room is the east door of the chapel. It is not locked tonight.' },
            { who: 'registrar', says: 'Leave him on the table when you are done. That is seen to in the morning.' },
            { who: 'registrar', says: 'Half three, the service gate on the east wall. Somebody will be there with the money. Don\'t make them wait.' },
            { who: 'registrar', says: 'And the man in the lodge by the gate goes to bed at eleven. He sleeps lightly.' },
        ],
        // Said at the yard, at the right moments.
        yard: {
            arrive: 'The order is on the clipboard. Tab to look at it.',
        },
        handover: {
            meet: [
                { who: 'buyer', says: 'Evening. You\'ll be the new one.' },
                { who: 'buyer', says: 'Through the bars is fine. Let\'s have a look at him.' },
            ],
            // What the buyer says over what he is handed, by the worst of it.
            judge: {
                sound: { who: 'buyer', says: 'Nice. Clean. You\'ve done this before.' },
                marginal: { who: 'buyer', says: 'Somebody\'s been careless. I\'ll pay for what I can use.' },
                reject: { who: 'buyer', says: 'This is meat. I don\'t pay for meat.' },
                nothing: { who: 'buyer', says: 'Then why am I stood here.' },
            },
            leave: [
                { who: 'buyer', says: 'Same again next week, he says. Go home, get warm.' },
                { who: 'buyer', says: 'And whoever that is in the lodge window, he\'s been watching you since one.' },
            ],
        },
        // What the sexton does on this night: comes out, finds the player with his torch, and goes back in.
        sexton: 'watches',
        morning: [
            { who: 'machine', says: 'You have one new message.' },
            { who: 'elin', says: 'They\'ve moved me to Saturdays as well. Four nights a week now. I\'m fine. I\'m fine, it\'s just more.' },
            { who: 'elin', says: 'Were you out last night? I rang at two. Don\'t be doing anything daft.' },
        ],
    },
    {
        id: 2,
        day: 'Friday',
        date: 5,
        clock: [23, 40],
        burial: {
            plot: 'F-6-5', forename: 'Kenneth', surname: 'Hague', born: 1951, age: 74,
            died: { day: 29, month: 10, year: YEAR }, buried: { day: 4, month: 11, year: YEAR },
            plate: 'KENNETH HAGUE  1951 - 2025',
            body: 'oldman',
        },
        // The meadow plot holds a woman of thirty buried yesterday under nobody's name, already opened.
        found: { plate: null, matches: false, stitched: true, missing: ['left kidney'] },
        order: {
            wanted: ['left kidney', 'right kidney', 'corneas'],
            check: [
                { says: 'Name plate on the lid', look: 'plate', verb: 'Find the plate', seen: 'There is no plate. Wicker, and no name on it anywhere.' },
                { says: 'Hip replacement, left', look: 'belly', verb: 'Look at him', seen: 'Not him. A woman, thirty at most, sewn up from her chin to her pubis.' },
                { says: 'Tattoo, anchor, right forearm', look: 'hands', verb: 'Look at the arms', seen: 'No anchor. A hospital band, cut off, the mark of it still on her wrist.' },
            ],
            handover: { place: 'The service gate, east wall', time: '03:00' },
        },
        machine: [
            { who: 'machine', says: 'You have one new message.' },
            { who: 'landlord', says: 'It\'s Firth. I\'ve had nothing since October. I\'m not a charity. I\'ll be round Monday with the lad.' },
        ],
        call: [
            { who: 'registrar', says: 'He was pleased with you. That is not easily done.' },
            { who: 'registrar', says: 'The meadow tonight. The green burials, north-west corner. Section F, row six, number five.' },
            { who: 'registrar', says: 'Kenneth Hague. Seventy-four. Wicker coffin, so mind your spade, there is no lid to speak of.' },
            { who: 'registrar', says: 'Kidneys again. And the corneas, there is a kit in the store now. The eye is not hard. Be gentle with it.' },
            { who: 'registrar', says: 'Same gate. Three o\'clock.' },
        ],
        // When the body is found to be the wrong one, and the player rings the number on the clipboard from the box by the gate.
        wrong: [
            { who: 'registrar', says: 'Describe her.' },
            { who: 'registrar', says: 'Baseball stitch, chin to pubis. Yes. Somebody\'s been before you.' },
            { who: 'registrar', says: 'Take what is left. It is still worth something, and she is not going to complain.' },
            { who: 'registrar', says: 'You did not ring me tonight. You understand. You did not see a name on her because there is not one.' },
        ],
        handover: {
            meet: [
                { who: 'buyer', says: 'Short tonight, he tells me.' },
                { who: 'buyer', says: 'Who else have you told about this. Anyone at all. Your sister, say.' },
            ],
            judge: {
                sound: { who: 'buyer', says: 'Good. That\'s good.' },
                marginal: { who: 'buyer', says: 'Careless again.' },
                reject: { who: 'buyer', says: 'No.' },
                nothing: { who: 'buyer', says: 'He won\'t like this.' },
            },
            leave: [{ who: 'buyer', says: 'Keep it that way. It\'s healthier for everybody.' }],
        },
        sexton: 'away',
        morning: [
            { who: 'machine', says: 'You have one new message.' },
            { who: 'unit', says: 'Holbeck Clinic again. Dr Anand has asked me to say the slot can be held for a further payment. Please ring.' },
        ],
    },
    {
        id: 3,
        day: 'Sunday',
        date: 7,
        clock: [22, 50],
        burial: {
            plot: 'E-4-14', forename: 'Jordan', surname: 'Pickles', born: 2006, age: 19,
            died: { day: 4, month: 11, year: YEAR }, buried: { day: 6, month: 11, year: YEAR },
            plate: 'JORDAN PICKLES  2006 - 2025',
            body: 'buyer',
        },
        // Cold, stiff and wrong: on the table he is breathing. Buried sedated, with the courier's tattoo the driver has.
        found: { plate: 'JORDAN PICKLES  2006 - 2025', matches: true, alive: true, tattoo: 'a swallow, the web of the left hand' },
        order: {
            wanted: ['left kidney', 'right kidney', 'liver', 'corneas'],
            check: [
                { says: 'Name plate on the lid', look: 'plate', verb: 'Read the plate', seen: 'Jordan Pickles, 2006 to 2025. The screws are new.' },
                { says: 'Tattoo, swallow, left hand', look: 'hands', verb: 'Look at his hands', seen: 'A swallow in the web of the left hand. The driver has the same one.' },
                { says: 'No embalming', look: 'belly', verb: 'Look at him', seen: 'No incisions, no trocar button. His colour is wrong for three days dead.' },
            ],
            handover: { place: 'The service gate, east wall', time: '02:30' },
        },
        machine: [
            { who: 'machine', says: 'You have no new messages.' },
        ],
        call: [
            { who: 'registrar', says: 'Earlier tonight. They want it before the roads are gritted.' },
            { who: 'registrar', says: 'A young one. Section E, row four, number fourteen. Jordan Pickles, nineteen. Sudden death, it says.' },
            { who: 'registrar', says: 'Everything worth having. Kidneys, the liver whole, the corneas. He is fresh. He will be the best thing you have had on that table.' },
            { who: 'registrar', says: 'Half two.' },
        ],
        // On the table: what the signs are, in the order they are seen.
        alive: [
            'The skin over the knuckles blanches under a thumb and comes back pink.',
            'The cut bleeds. Bright, and it keeps on.',
            'The mirror from the tray, held to the lips, mists.',
        ],
        // If the player stops and hides him in the cold room, and lies.
        lie: [
            { who: 'registrar', says: 'Nothing in him at all.' },
            { who: 'registrar', says: 'I see.' },
            { who: 'registrar', says: 'Then you had better go home. I will ring you earlier on Tuesday.' },
        ],
        handover: {
            meet: [{ who: 'driver', says: 'He\'s in the van. Give it here.' }],
            judge: {
                sound: { who: 'driver', says: 'Right.' },
                marginal: { who: 'driver', says: 'Right.' },
                reject: { who: 'driver', says: 'Right.' },
                nothing: { who: 'driver', says: 'He\'s not going to be happy with you.' },
            },
            leave: [{ who: 'driver', says: 'Go home.' }],
        },
        sexton: 'away',
        morning: [
            { who: 'machine', says: 'You have one new message.' },
            { who: 'elin', says: 'Somebody rang here asking for you. Said he was from the council. He knew my name. Who was that?' },
        ],
    },
    {
        id: 4,
        day: 'Tuesday',
        date: 9,
        clock: [22, 20],
        burial: null,
        order: {
            wanted: [],
            check: [],
            handover: { place: 'The service road, past the gate', time: '23:30' },
        },
        machine: [
            { who: 'machine', says: 'You have one new message.' },
            { who: 'elin', says: 'A man came to the unit. Asked the nurse what my blood group was. She didn\'t tell him. Ring me. Please ring me.' },
        ],
        call: [
            { who: 'registrar', says: 'No grave tonight.' },
            { who: 'registrar', says: 'They want to meet you properly. The service road, past the gate, half eleven. Walk through the yard, not round.' },
            { who: 'registrar', says: 'Bring nothing. You are what is being collected tonight, in a manner of speaking. I mean your money.' },
        ],
        sexton: 'away',
        morning: [],
    },
    {
        id: 5,
        day: 'Thursday',
        date: 11,
        clock: [21, 0],
        burial: {
            plot: 'F-8-9', forename: 'Walter', surname: 'Kaye', born: 1954, age: 71,
            died: { day: 11, month: 11, year: YEAR }, buried: { day: 11, month: 11, year: YEAR },
            plate: null,
            body: 'sexton',
        },
        found: { plate: null, matches: true },
        order: {
            wanted: ['left kidney'],
            check: [
                { says: 'Blood group on the order', look: 'plate', verb: 'Read the order again', seen: 'O negative. Elin\'s. And yours.' },
            ],
            handover: { place: 'The cold room', time: '01:00' },
        },
        machine: [
            { who: 'machine', says: 'You have one new message.' },
            { who: 'unit', says: 'Holbeck Clinic. The slot has gone, I\'m afraid. We\'ll keep Miss Elin\'s details on file.' },
        ],
        call: [
            { who: 'registrar', says: 'I have something for you. Not for them. For you.' },
            { who: 'registrar', says: 'A kidney for your sister. Matched. Tonight. I have been looking for one since your first night, I want you to know that.' },
            { who: 'registrar', says: 'The meadow. Section F, row eight, number nine. Dug this evening, so it will be easy going.' },
            { who: 'registrar', says: 'Do not read the name. Bring me the left kidney and the debt is gone. Hers as well as yours.' },
        ],
        // What the player finds out, and where, before the end: the name on the order is the sexton's;
        // the Registrar is the hospital's burial clerk; the cemetery is where his donors are put.
        truth: [
            'The man in the meadow grave is the sexton. Walter Kaye. He saw you on the first night and never told anyone.',
            'The order is on hospital paper. Bereavement and Burials Office, County Hospital. Signed D. Garside, Clerk.',
            'The cold room\'s ledger runs back eleven years. Every page is a name from the public ground.',
        ],
        sexton: 'dead',
        morning: [],
    },
];

// How it can end. Which one is chosen on night five, by what is done with the kidney and the register.
export const ENDINGS = {
    deliver: 'Elin has a kidney by Christmas. The phone rings on the first Thursday of January. You pick it up.',
    refuse: 'The register and the cooler are on the steps of the police station at six. Elin is on the list, as before.',
    registrar: 'Garside is on the table in the cold room. The order is in his own hand. You know where to take what is wanted.',
    van: 'The van was always going to leave with you in it. Elin\'s blood group was on the list because yours is the same.',
};

// The night a story burial is in the ground, by its plot: the register reads these as well as its own.
export function burials(night) {
    return NIGHTS.filter((n) => n.burial && n.id <= night).map((n) => n.burial);
}
