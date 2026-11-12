"""Every recording there is to choose from, made ready to be listened to.

    python3 tools/audition.py <downloads> assets/audition        (needs ffmpeg)

Nobody can choose a sound from its description: the first set chosen that
way had kitchen boards in it. So before anything goes into the game it is
listened to, on dev/listen.html, and this makes what that page plays: of
every recording in `<downloads>` (a directory to each Freesound id, and
SOURCES*.md saying what each is and what it was fetched for) its busiest
twenty seconds, one channel, at one loudness, as `<id>.flac`; and
`list.json`, which says what each is, whose, and what it might be for.
"""

import array
import json
import os
import re
import subprocess
import sys

LENGTH = 20         # seconds of each recording that are kept: wherever most is going on
LOUD = -24          # LUFS they are all set to, so that none is judged for being quiet
PEAK = -2

# What a recording was fetched for, by the heading it is under in SOURCES*.md, as the listening page says it.
FOR = [
    (r'slicing|blade', 'A blade drawn through flesh'),
    (r'bone|scrape', 'A blade on bone'),
    (r'stretch|tear|part', 'Flesh parting'),
    (r'handling|movement', 'Wet tissue moved'),
    (r'glove', 'A gloved hand'),
    (r'steel|instrument', 'Steel put down'),
    (r'dropped|laid|set.down', 'Something soft laid down'),
    # Round four: the night outside the table.
    (r'phone ringing', 'The phone ringing'),
    (r'answering', 'The answering machine'),
    (r'handset', 'The handset'),
    (r'a door', 'A door'),
    (r'on carpet', 'Steps on carpet'),
    (r'on gravel', 'Steps on gravel'),
    (r'on grass', 'Steps on grass'),
    (r'on mud', 'Steps on mud'),
    (r'on a pavement', 'Steps on a pavement'),
    (r'room tone', 'The flat at night'),
    (r'night outside', 'Outside at night'),
    (r'spade', 'A spade in clay'),
    (r'lid splitting', 'The lid splitting'),
    (r'bier', 'The bier rolling'),
    (r'van idling', 'A van idling'),
    # Round five: the sandbox. Its headings keep clear of the words above (no "bone", no "room tone").
    (r'pistol shot', 'A pistol shot'),
    (r'rifle shot', 'A rifle shot'),
    (r'shotgun shot', 'A shotgun shot'),
    (r'bullet into', 'A bullet in a body'),
    (r'spent casing', 'A casing on concrete'),
    (r'racked', 'A gun racked'),
    (r'swung', 'A swing through the air'),
    (r'knife stab', 'A stab'),
    (r'blunt blow', 'A blunt blow'),
    (r'limb snaps', 'A bone cracking'),
    (r'body falling', 'A body falling'),
    (r'dripping', 'Dripping'),
    (r'spurt', 'A spurt'),
    (r'concrete hall', 'The empty hall'),
]


def run(*args, **more):
    return subprocess.run(args, check=True, capture_output=True, **more)


def listed(downloads):
    """What SOURCES*.md say of each recording: id -> { what it is for, uploader, title, licence, what is in it }."""
    found = {}
    for name in sorted(f for f in os.listdir(downloads) if re.fullmatch(r'SOURCES\d*\.md', f)):
        purpose, columns = None, None
        for line in open(os.path.join(downloads, name)):
            if line.startswith('## '):
                purpose = next((said for pattern, said in FOR if re.search(pattern, line, re.I)), None)
            cells = [c.strip() for c in line.strip().strip('|').split('|')]
            if line.startswith('| id'):
                columns = [c.lower() for c in cells]
            row = re.match(r'\| \[(\d+)\]', line)
            if not (row and purpose and columns):
                continue
            cell = dict(zip(columns, cells))
            path = cell[next(c for c in columns if c.startswith('file'))].strip('`')
            title = cell.get(next((c for c in columns if 'title' in c), ''), '') or re.sub(r'^\d+_|\.\w+$', '', os.path.basename(path))
            found[int(row.group(1))] = {
                'for': purpose, 'uploader': cell['uploader'], 'title': title, 'licence': cell[next(c for c in columns if c.startswith('licen'))],
                'what': cell[columns[-1]], 'path': path,
            }
    return found


def busiest(path):
    """Where the busiest LENGTH seconds of a recording begin, and how long the recording is."""
    heard = array.array('h', run('ffmpeg', '-loglevel', 'error', '-i', path, '-ac', '1', '-ar', '8000', '-f', 's16le', '-').stdout)
    seconds = [sum(v * v for v in heard[i:i + 8000]) for i in range(0, len(heard), 8000)]
    span = min(LENGTH, len(seconds))
    start = max(range(len(seconds) - span + 1), key=lambda i: sum(seconds[i:i + span]))
    return start, len(heard) / 8000


def main(downloads, out):
    os.makedirs(out, exist_ok=True)
    entries = []
    for sound_id, entry in sorted(listed(downloads).items()):
        path = entry.pop('path')
        if not os.path.exists(path):
            print(f'{sound_id}: listed but not downloaded')
            continue
        start, whole = busiest(path)
        cut, shaped = ['-ss', str(start), '-t', str(LENGTH)], 'aformat=channel_layouts=mono,highpass=f=60'
        said = run('ffmpeg', '-hide_banner', '-nostats', *cut, '-i', path, '-af', shaped + ',ebur128=peak=true', '-f', 'null', '-', text=True).stderr
        summary = said[said.rindex('Summary:'):]
        lufs, peak = (float(re.search(pattern, summary).group(1)) for pattern in (r'I:\s+(-?[\d.]+) LUFS', r'Peak:\s+(-?[\d.]+) dBFS'))
        gain = min(LOUD - lufs, PEAK - peak)
        run('ffmpeg', '-y', '-loglevel', 'error', *cut, '-i', path, '-af', f'{shaped},volume={gain:.2f}dB', '-ar', '48000', '-sample_fmt', 's16',
            os.path.join(out, f'{sound_id}.flac'))
        entries.append({'id': sound_id, 'seconds': round(whole), 'raised': round(gain), **entry})
        print(f'{sound_id:8} {entry["for"]:28} from {start:3}s of {whole:5.0f}s, {gain:+.0f} dB')
    with open(os.path.join(out, 'list.json'), 'w') as f:
        json.dump(entries, f, indent=1)


if __name__ == '__main__':
    main(*sys.argv[1:3])
