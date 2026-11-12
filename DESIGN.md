# COLD CHAIN (working title)

A first-person horror game about digging the recently dead out of a municipal
cemetery, taking what is worth money out of them, making sure it will sell,
and selling it to people who should not be met at night. It plays like The
Mortuary Assistant: one place, a procedure done with your hands, a list that
has to be worked through while the night goes wrong around it.

It replaces the Sad Satan walk as the thing being built. `~/sadsatan-v3` stays
as it is; this is a new tree and takes only the engine from it.

## What it is not

Not a corridor of jump scares. The earlier research (`~/sadsatan-v3/dev/
FEAR-RESEARCH.md`) is the rule book here: three to five hard hits in the
whole game, minutes apart; build-ups that mostly resolve to nothing; things
changed while the player was looking at their work; scares that land while
the hands are busy.

## The premise

Winter. You were a mortuary technician at the county hospital until the
cuts. Your sister Elin is on dialysis three nights a week, and the clinic
has stopped taking promises. A man who gives his name as the Registrar
phones. He has the burial register for St Dymphna's municipal cemetery: who
went into the ground this week, who went in without embalming (the paupers'
plots and the green burials), and what each of them is good for. He has
buyers. He needs somebody who can open a body properly.

What is taken from a body that has been in cold ground for two days is not
what a transplant ward wants, and the game knows it: corneas, heart valves,
tendon, bone, skin, and whole organs for buyers who do not say what they
are for. Who buys a dead man's liver, and why they pay more for some names
than others, is the question the story answers.

## The shape of a night

Five nights. Each is fifteen to twenty-five minutes and has four parts.

1. **The call.** The flat, the answering machine, the phone. The Registrar
   reads the order: a name, a plot, a date of burial, what is wanted. It is
   written onto the clipboard, which is the only interface the game has.
   Elin's messages, the clinic's letters and what is on the television are
   where the story is told.
2. **The yard.** Find the plot by section, row and number, by lantern, among
   a few hundred markers. Cut the turf, dig, break the lid. Digging is loud
   and slow and the sexton's house has a light. Check the body against the
   order before lifting it: the right plot does not always hold the right
   person. Winch it onto the bier and wheel it to the old chapel of rest.
3. **The table.** The procedure, by hand, in order:
   verify (tag, face, scars against the sheet) · assess (rigor, lividity,
   temperature, eyes: how long dead, and does that match the date) · open ·
   take each thing on the order · grade it under the lamp (sound, marginal,
   reject: disease, embalming fluid, your own knife) · flush, bag, label,
   ice · close · put the body back, or do not, and be seen to have dug.
   Mistakes cost money. Some mistakes cannot be made twice.
4. **The handover.** A place and a time. A van, one buyer or two. Count what
   they give you. Watch who gets out of the van and where they stand.
   Decide whether to walk up to it.

Then the flat again, the money against the debt, and the next call.

## The cutting

Asked for by the user on 2026-11-10: "realistic cutting, like the user should
have to actually remove the organs with a scalpel". So the table is not a
checklist of buttons. The knife is in the hand and the mouse is the hand.

- **The blade goes where it is dragged.** Press to put the edge on the skin,
  drag to draw it along. The cut is left where it was made, as long and as
  crooked as the hand was, and it opens behind the blade. Pressure is how
  long and how slowly: too light and it is a scratch that has to be gone
  over, too deep and what is underneath is opened with it.
- **The body is opened in the order a body is opened.** Skin (the Y from the
  shoulders to the breastbone and down), the flaps reflected, the plate of
  the chest cut free through the cartilages with shears, the plate lifted.
  Each is its own tool and its own motion.
- **Nothing lifts until it is free.** An organ hangs by what feeds it: a
  kidney by its artery, its vein and the ureter, in its fat; a liver by its
  ligaments and the vessels at the porta; a heart by the great vessels. Each
  has to be found, clamped where it matters, and cut. Pull on something
  still attached and it tears, and a torn organ is graded as torn.
- **The knife marks what it touches.** A nick in the capsule of a kidney is
  there when the buyer turns it over. Cutting toward the thing being taken
  is how money is lost.
- **Hands.** Tools are picked up from the tray and put back, they are
  bloody after use, and the hand holding the organ is not the hand holding
  the blade.

## What goes wrong

Drawn from the story first and from a hidden state second (how much noise,
how many graves left open, how the last sale went). Nothing shows a meter.

- The body is the wrong one. The plot was reused this week.
- The body has been opened before. Somebody else's stitching, nothing left.
- The body is embalmed: nothing in it will sell and the night is a loss.
- The body is not dead. Signs first (lividity that blanches, a mirror that
  fogs, an eye that is not where it was), and a decision the game remembers.
- The sexton comes out with a torch. The gate is chained when you go back.
- The buyer is short, or wants something that was not on the order, or
  wants you in the van. The second man is behind you.
- The order is for somebody who was alive this afternoon.
- The ones you have opened. Never explained, never close, never more than
  one new thing a night: a grave you filled is open; someone is standing in
  the row you worked yesterday; the cooler was shut.

## The story

**Night one, Thursday.** A clean job, taught by the Registrar's voice and
the clipboard. An old man, both kidneys (the corneas start on night two,
when there is a kit for them). The buyer is polite. The money is good.
Elin leaves a message about the fistula in her arm. The sexton comes out
with his torch, looks at you for a long time, and goes back in.

Every line of all five nights is in `src/game/story.js`.

**Night two, Friday.** The plot holds a woman of thirty, not the man on the
order, buried yesterday, already opened and sewn with a mortician's baseball
stitch. One kidney is missing and it was taken from somebody whose heart
was beating. The Registrar says take what is left. The buyer asks who else
you have told.

**Night three, Sunday.** The order is a boy of nineteen, "sudden death".
He is cold and stiff and wrong, and on the table he is not dead: he was
buried sedated, with a courier's tattoo you saw on the buyer's driver.
Take him apart as ordered, or stop, hide him in the chapel, and tell the
Registrar a lie. Either way the next call comes earlier.

**Night four, Tuesday.** The handover is moved to the service road. Two
vans. They have a table of their own in the second one and a list with your
blood group on it. The yard has to be crossed in the dark with them in it.
If the boy lived, he is who opens the gate.

**Night five, Thursday.** The Registrar offers the end of the debt: a
kidney for Elin, matched, tonight, from a plot dug this evening. The name on
the order is the sexton's, who saw you on the first night and never called
anyone. The Registrar is the hospital's own burial clerk; the cemetery is
where his donors are put when the buyers have finished with them, and you
have been cleaning up after him and selling him the leavings.

**Endings.** Deliver, and Elin gets a kidney and you get the next call.
Refuse, and put the register and the cooler on the steps of the police
station, and Elin is on the list as before. Take the Registrar's own. Or the
one where the van was always going to leave with you in it.

## The look and the sound

Colour, drained: sodium light at the road, a cold lantern, the white of the
table lamp. No tape filter, no HUD but the clipboard and your hands. The
people have to hold up at arm's length under a lamp, which the figures in
Six Six S1x did not: these are MakeHuman bodies with their real skins, eyes,
hair and clothes, and the dead ones get a body's colours (lividity on the
side they lay on, the green of the flank on day three).

Sound is recordings, not synthesis: spade in wet clay, a lid splitting, a
saw, a van idling at the gate. The voices are acted: the Registrar, Elin,
two buyers, the sexton.

## The bar

Said by the user on 2026-11-10 and not negotiable: amazing graphics, amazing
sound design, and optimised.

- **Graphics.** Scanned surfaces and scanned props (Poly Haven), people with
  real skins, shadows from every light, contact shading, a graded picture.
  Every scene is judged from screenshots before it is called done.
- **Sound.** Recordings only. No noise-and-oscillator synthesis anywhere:
  that is what the user heard as scraping in Six Six S1x and called "ai
  generated html slop". Foley from Freesound (CC0 or CC BY, credited),
  placed in the room, with a real reverb. Anything that plays constantly is
  listened to by a person before it ships.
- **Optimised.** Sixty frames a second at 1080p on the Radeon 680M with
  room to spare, measured with the frame cap off. Assets load per scene.

## Build order

1. People who look right on a table under a lamp. Nothing else matters if
   this fails.
2. The chapel of rest as one room and night one's whole procedure in it.
3. The yard: plots, digging, the lift, the sexton.
4. The handover and the buyers.
5. The flat, the calls, nights two to five, the endings.
6. Voices, sound, tuning against the research.

## Decisions made without asking, to be overruled

- New tree and new name; Six Six S1x is left where it stands.
- Colour rather than the grey tape.
- Five nights, one cemetery, no driving.
- The supernatural is kept to what could be guilt.
- Voices would use Fish Audio (96,916 credits). None spent until told to.
