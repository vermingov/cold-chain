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
                { says: 'Name plate on the lid', look: 'plate', verb: 'Press E to read the name plate', seen: 'Harold Thorp, 1947 to 2025. The brass is already going green.' },
                { says: 'Appendix scar, low on the right', look: 'belly', verb: 'Press E to open his shirt', seen: 'An old white scar, low on the right of his belly. That\'s his appendix.' },
                { says: 'Ring on the left hand', look: 'hands', verb: 'Press E to look at his hands', seen: 'A thin gold ring on his left hand, worn deep into the finger.' },
            ],
            handover: { place: 'The service gate, east wall', time: '03:30' },
        },
        machine: [
            { who: 'machine', says: 'You have two new messages. First new message.' },
            { who: 'elin', says: 'Hiya. It\'s me. They had me on for four hours again because the line kept alarming.' },
            { who: 'elin', says: 'The arm\'s gone a funny colour round the fistula. The nurse says it\'s fine. She said it like it isn\'t.' },
            { who: 'elin', says: 'Don\'t ring back tonight, I\'m knackered. Love you. Eat something.' },
            { who: 'machine', says: 'Next new message.' },
            { who: 'unit', says: 'Hello, it\'s Joanne at Holbeck Clinic, calling for Dr Anand. We still haven\'t had the deposit for your sister\'s assessment.' },
            { who: 'unit', says: 'We can hold her slot until the nineteenth, but after that it has to go to the next family. Could you give us a ring back?' },
            { who: 'machine', says: 'End of messages.' },
        ],
        call: [
            { who: 'registrar', says: 'Good, you\'re in. Have you got something to write with?' },
            { who: 'registrar', says: 'St Dymphna\'s, on Vicarage Road. The public ground\'s at the top, past the chapel. Section E, row seven, number ten.' },
            { who: 'registrar', says: 'Harold Thorp, seventy-eight. Council funeral on Tuesday, and nobody came. He won\'t be embalmed, the council don\'t pay for that.' },
            { who: 'registrar', says: 'I want both kidneys. Take them out whole, with as much of the tubes as you can get. Nick one and it\'s worth half.' },
            { who: 'registrar', says: 'Make sure it\'s him before you lift him out. The name plate, the scar on his belly, his ring. They reuse the ground up there.' },
            { who: 'registrar', says: 'The tools are in the shed behind the chapel. The cold room\'s through the chapel\'s east door. I\'ve left it unlocked.' },
            { who: 'registrar', says: 'Leave him on the table when you\'ve finished. Someone will see to him in the morning.' },
            { who: 'registrar', says: 'Half three, at the service gate on the east wall. Someone will be there with your money. Don\'t keep them waiting.' },
            { who: 'registrar', says: 'One more thing. The man in the lodge by the gate goes to bed at eleven, but he\'s a light sleeper.' },
        ],
        // Said at the yard, at the right moments.
        yard: {
            arrive: 'The order is on your clipboard. Press Tab to look at it.',
        },
        handover: {
            meet: [
                { who: 'buyer', says: 'Evening. You\'ll be the new one.' },
                { who: 'buyer', says: 'Pass it through the bars, that\'s fine. Let\'s have a look.' },
            ],
            // What the buyer says over what he is handed, by the worst of it.
            judge: {
                sound: { who: 'buyer', says: 'Nice and clean. You\'ve done this before.' },
                marginal: { who: 'buyer', says: 'You\'ve been careless. I\'ll pay for what I can use.' },
                reject: { who: 'buyer', says: 'This is meat. I don\'t pay for meat.' },
                nothing: { who: 'buyer', says: 'Nothing? Then what am I stood here for?' },
            },
            leave: [
                { who: 'buyer', says: 'Your man on the phone says same again next week. Go home and get warm.' },
                { who: 'buyer', says: 'And the old boy in the lodge window has been watching you since one o\'clock.' },
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
                { says: 'Name plate on the lid', look: 'plate', verb: 'Press E to look for a name plate', seen: 'There\'s no plate. It\'s a wicker coffin with no name on it anywhere.' },
                { says: 'Hip replacement, left', look: 'belly', verb: 'Press E to look at him', seen: 'It isn\'t him. It\'s a woman, thirty at the most, sewn up from her chin to her pubis.' },
                { says: 'Tattoo, anchor, right forearm', look: 'hands', verb: 'Press E to look at the arms', seen: 'No anchor. Someone has cut a hospital band off her wrist. You can still see the mark.' },
            ],
            handover: { place: 'The service gate, east wall', time: '03:00' },
        },
        machine: [
            { who: 'machine', says: 'You have one new message.' },
            { who: 'landlord', says: 'It\'s Mr Firth. I\'ve not had a penny off you since October, and I\'m not a charity. I\'ll be round on Monday with my lad.' },
        ],
        call: [
            { who: 'registrar', says: 'Our friend at the gate was pleased with you. He isn\'t easily pleased.' },
            { who: 'registrar', says: 'It\'s the meadow tonight, where they do the green burials, up in the north-west corner. Section F, row six, number five.' },
            { who: 'registrar', says: 'Kenneth Hague, seventy-four. He\'s in a wicker coffin, so mind your spade. There\'s no lid to speak of.' },
            { who: 'registrar', says: 'Kidneys again, and the corneas. There\'s a kit for them in the shed now. Eyes aren\'t hard, just be gentle.' },
            { who: 'registrar', says: 'Same gate, three o\'clock.' },
        ],
        // When the body is found to be the wrong one, and the player rings the number on the clipboard from the box by the gate.
        wrong: [
            { who: 'registrar', says: 'Tell me what she looks like.' },
            { who: 'registrar', says: 'Baseball stitch, chin to pubis. Right. Someone\'s been there before you.' },
            { who: 'registrar', says: 'Take what\'s left. It\'s still worth something, and she\'s not going to complain.' },
            { who: 'registrar', says: 'You didn\'t ring me tonight, do you understand? And you didn\'t see a name on her, because there isn\'t one.' },
        ],
        handover: {
            meet: [
                { who: 'buyer', says: 'I hear you\'re short tonight.' },
                { who: 'buyer', says: 'Who else have you told about this? Anyone at all? Your sister, maybe?' },
            ],
            judge: {
                sound: { who: 'buyer', says: 'Good. That\'s good.' },
                marginal: { who: 'buyer', says: 'Careless again.' },
                reject: { who: 'buyer', says: 'No.' },
                nothing: { who: 'buyer', says: 'Nothing? He won\'t like that.' },
            },
            leave: [{ who: 'buyer', says: 'Keep it that way. It\'s healthier for everybody.' }],
        },
        sexton: 'away',
        morning: [
            { who: 'machine', says: 'You have one new message.' },
            { who: 'unit', says: 'It\'s Holbeck Clinic again. Dr Anand\'s asked me to let you know we can keep holding the slot for a further payment. Please ring us back.' },
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
                { says: 'Name plate on the lid', look: 'plate', verb: 'Press E to read the name plate', seen: 'Jordan Pickles, 2006 to 2025. The screws in it are brand new.' },
                { says: 'Tattoo, swallow, left hand', look: 'hands', verb: 'Press E to look at his hands', seen: 'A swallow tattooed between his left thumb and finger. The driver has the same one.' },
                { says: 'No embalming', look: 'belly', verb: 'Press E to look at him', seen: 'No embalming cuts, no trocar button. His colour\'s wrong for someone three days dead.' },
            ],
            handover: { place: 'The service gate, east wall', time: '02:30' },
        },
        machine: [
            { who: 'machine', says: 'You have no new messages.' },
        ],
        call: [
            { who: 'registrar', says: 'It\'s earlier tonight. They want it done before the gritters are out.' },
            { who: 'registrar', says: 'It\'s a young one this time. Section E, row four, number fourteen. Jordan Pickles, nineteen. Sudden death, it says here.' },
            { who: 'registrar', says: 'I want everything worth having. Kidneys, the whole liver, the corneas. He\'s fresh. He\'ll be the best you\'ve had on that table.' },
            { who: 'registrar', says: 'Half two, at the gate.' },
        ],
        // On the table: what the signs are, in the order they are seen.
        alive: [
            'You press a thumb on his knuckles. The skin goes white, then pink again.',
            'The cut is bleeding. Bright red, and it isn\'t stopping.',
            'You hold the mirror from the tray to his lips. It mists over.',
        ],
        // If the player stops and hides him in the cold room, and lies.
        lie: [
            { who: 'registrar', says: 'Nothing in him worth having. That\'s what you\'re telling me.' },
            { who: 'registrar', says: 'I see.' },
            { who: 'registrar', says: 'Then you\'d better go home. I\'ll ring you earlier on Tuesday.' },
        ],
        handover: {
            meet: [{ who: 'driver', says: 'The boss is in the van. Give it here.' }],
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
            { who: 'elin', says: 'Someone rang here asking for you. He said he was from the council, and he knew my name. Who was that?' },
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
            { who: 'elin', says: 'A man came to the unit today and asked the nurse what my blood group was. She didn\'t tell him. Ring me. Please, just ring me.' },
        ],
        call: [
            { who: 'registrar', says: 'There\'s no grave tonight.' },
            { who: 'registrar', says: 'They want to meet you properly. The service road, past the gate, at half eleven. Come through the cemetery, not round the outside.' },
            { who: 'registrar', says: 'Don\'t bring anything. It\'s you they\'re collecting tonight, in a manner of speaking. Your money, I mean.' },
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
                { says: 'Blood group on the order', look: 'plate', verb: 'Press E to read the order again', seen: 'O negative. Elin\'s blood group. And yours.' },
            ],
            handover: { place: 'The cold room', time: '01:00' },
        },
        machine: [
            { who: 'machine', says: 'You have one new message.' },
            { who: 'unit', says: 'It\'s Holbeck Clinic. I\'m afraid the slot\'s gone now. We\'ll keep your sister\'s details on file.' },
        ],
        call: [
            { who: 'registrar', says: 'I\'ve got something for you. Not for them, for you.' },
            { who: 'registrar', says: 'A kidney for your sister. A match, tonight. I\'ve been looking for one since your first night, I want you to know that.' },
            { who: 'registrar', says: 'It\'s in the meadow. Section F, row eight, number nine. It was only dug this evening, so it\'ll be easy going.' },
            { who: 'registrar', says: 'Don\'t read the name. Bring me the left kidney and the debt\'s gone. Hers as well as yours.' },
        ],
        // What the player finds out, and where, before the end: the name on the order is the sexton's;
        // the Registrar is the hospital's burial clerk; the cemetery is where his donors are put.
        truth: [
            'The man in the meadow grave is the sexton, Walter Kaye. He saw you that first night and never told anyone.',
            'The order\'s on hospital paper: Bereavement and Burials Office, County Hospital. It\'s signed D. Garside, Clerk.',
            'The ledger in the cold room goes back eleven years. Every name in it is from the public ground.',
        ],
        sexton: 'dead',
        morning: [],
    },
];

// How it can end. Which one is chosen on night five, by what is done with the kidney and the register.
export const ENDINGS = {
    deliver: 'Elin has her kidney by Christmas. On the first Thursday in January, the phone rings. You answer it.',
    refuse: 'At six in the morning you leave the register and the cooler on the steps of the police station. Elin stays on the waiting list.',
    registrar: 'Garside is on the table in the cold room, and the order is in his own handwriting. You know where to take what\'s wanted.',
    van: 'The van was always going to leave with you in it. Elin\'s blood group was on their list because it\'s the same as yours.',
};

// The night a story burial is in the ground, by its plot: the register reads these as well as its own.
export function burials(night) {
    return NIGHTS.filter((n) => n.burial && n.id <= night).map((n) => n.burial);
}
