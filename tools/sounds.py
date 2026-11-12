"""The sounds of the table: the recordings that were listened to and passed.

    python3 tools/sounds.py assets/audition dev/verdicts.json assets/sounds

Every sound in the game is a recording of a real thing, other people's,
from Freesound under CC0 or CC BY. Which of them are in the game is not
decided here or by anybody reading a description: every candidate is put on
dev/listen.html (tools/audition.py), somebody with ears marks each one, and
this takes what they passed. A recording marked yes is in; where nothing
was marked yes for a purpose, the maybes are; and a purpose nothing passed
for has no sound at all, which the game takes to mean silence.

What goes in is the same twenty seconds that were listened to, as they were
listened to, as Ogg Vorbis (ffmpeg). Written out: the files, `manifest.json`
({ name: [file, ...] }), and `CREDITS.md`, which says whose every recording is.
"""

import json
import os
import subprocess
import sys

# What each purpose on the listening page is called in the game. A blade sounds the same in skin, fat, flesh and
# whatever is inside until enough has been passed to tell them apart.
NAMES = {
    'A blade drawn through flesh': ['skin', 'fat', 'flesh', 'organ', 'snip'],
    'A blade on bone': ['bone'],
    'Flesh parting': ['give'],
    'Wet tissue moved': ['wet'],
    'A gloved hand': ['glove'],
    'Something soft laid down': ['lay'],
    'The phone ringing': ['ring'],
    'The answering machine': ['beep'],
    'The handset': ['handset'],
    'A door': ['door'],
    'Steps on carpet': ['step-carpet'],
    'Steps on gravel': ['step-gravel'],
    'Steps on grass': ['step-grass'],
    'Steps on mud': ['step-mud'],
    'Steps on a pavement': ['step-tarmac'],
    'The flat at night': ['room'],
    'Outside at night': ['night'],
    'A spade in clay': ['dig'],
    'The lid splitting': ['lid'],
    'The bier rolling': ['bier'],
    'A van idling': ['van'],
}


# The owner asked for the game's sounds before listening to them (2026-11-12, "there isnt any footstep sounds"):
# where a purpose has nothing passed yet, this take is in, until it is marked no or something else is marked yes.
PICKS = {
    'The phone ringing': 25480, 'The answering machine': 671235, 'The handset': 616840, 'A door': 830497,
    'Steps on carpet': 801034, 'Steps on gravel': 645451, 'Steps on grass': 556042, 'Steps on mud': 657869,
    'Steps on a pavement': 465299, 'The flat at night': 635732, 'Outside at night': 784410, 'A spade in clay': 574721,
    'The lid splitting': 663946, 'The bier rolling': 635488, 'A van idling': 453990,
}


def main(audition, verdicts, out):
    takes = json.load(open(os.path.join(audition, 'list.json')))
    said = {int(sound_id): v.get('verdict') for sound_id, v in json.load(open(verdicts)).items()}
    os.makedirs(out, exist_ok=True)
    for old in os.listdir(out):
        if old.endswith(('.flac', '.ogg')):
            os.remove(os.path.join(out, old))
    manifest, credits = {}, []
    for purpose, names in NAMES.items():
        mine = [t for t in takes if t['for'] == purpose]
        passed = [t for t in mine if said.get(t['id']) == 'yes'] or [t for t in mine if said.get(t['id']) == 'maybe'] \
            or [t for t in mine if t['id'] == PICKS.get(purpose) and said.get(t['id']) != 'no']
        print(f'{purpose:28} {len(passed)} of {len(mine)}: {", ".join(t["title"] for t in passed) or "nothing passed, silent"}')
        if not passed:
            continue
        files = []
        for n, take in enumerate(passed):
            file = f'{names[0]}-{n + 1}.ogg'
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(audition, f'{take["id"]}.flac'), '-c:a', 'libvorbis', '-q:a', '6',
                            os.path.join(out, file)], check=True)
            files.append(file)
            credits.append(f'- `{file}`: "{take["title"]}" by {take["uploader"]}, {take["licence"]}. '
                           f'https://freesound.org/people/{take["uploader"]}/sounds/{take["id"]}/')
        for name in names:
            manifest[name] = files
    with open(os.path.join(out, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1)
    with open(os.path.join(out, 'CREDITS.md'), 'w') as f:
        f.write('# The recordings\n\nEvery sound in the game is one of these, from Freesound: twenty seconds of it, one channel,\n'
                'set to a level, and otherwise as its maker recorded it (tools/audition.py, tools/sounds.py).\n\n' + '\n'.join(credits) + '\n')


if __name__ == '__main__':
    main(*sys.argv[1:4])
