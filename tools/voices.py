"""The voices: every line said aloud in the game, as recorded by Fish Audio.

    python3 tools/voices.py        fetch whatever is missing into assets/voices

Each line is spoken from its text in src/game/story.js, by a voice chosen for
whoever says it. The lines were generated once (every generation costs
credits); what is kept here is where each one is, so building again is a
download and never another charge. `manifest.json` maps a line's text, exactly
as story.js has it, to its file: the game plays the file when it shows the line.
"""

import json
import os
import subprocess
import urllib.request

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'voices')
FISH = 'https://platform.r2.fish.audio/tasks/2026-11-12/{}.mp3'

# Who speaks in which voice (Fish Audio voice ids), for whoever makes the next lines.
VOICES = {
    'registrar': 'beb44e5fac1e4b33a15dfcdcc2a9421d',    # Sleepless historian: British, middle-aged, calm
    'elin': '933563129e564b19a115bedd57b7406a',         # Sarah (Fish official): young, soft
    'unit': 'b347db033a6549378b48d00acb0d06cd',         # Selene (Fish official): middle-aged, calm
    'machine': 'f6a19fe5ab494e1fa51bb1476d583a44',      # Abby: smooth, even
    'buyer': 'e0e2468ce2d746c1b20a4414435f6f48',        # Phat phap: British, deep, calm
}

# Night one: the text as story.ts has it, the Fish task it was generated in, and its file. A line whose words
# were rewritten was generated again into a new file (-v2), so the old one is never overwritten by mistake.
LINES = [
    ('You have two new messages. First new message.', '46e72d90a7994506ad3d71d6e2a39350', 'n1-01.mp3'),
    ('Hiya. It\'s me. They had me on for four hours again because the line kept alarming.', '363f720c777d4c268f406c2122655083', 'n1-02.mp3'),
    ('The arm\'s gone a funny colour round the fistula. The nurse says it\'s fine. She said it like it isn\'t.', '6fa5fcb1bd3e4a9b8c1f6cdf21b8d973', 'n1-03.mp3'),
    ('Don\'t ring back tonight, I\'m knackered. Love you. Eat something.', '2fd8c9bea59c4f3b8a51cc52aac0e530', 'n1-04.mp3'),
    ('Next new message.', '005657aee83d4ba8bcc309b5e75991cf', 'n1-05.mp3'),
    ("Hello, it's Joanne at Holbeck Clinic, calling for Dr Anand. We still haven't had the deposit for your sister's assessment.", '683f735ab74b44bca9133c29a1aa585c', 'n1-06-v2.mp3'),
    ('We can hold her slot until the nineteenth, but after that it has to go to the next family. Could you give us a ring back?', 'a0c026e1b1694f7ca557cf7109ae8b63', 'n1-07-v2.mp3'),
    ('End of messages.', 'c56b1cbec8224ec8af6f2a40db4639ff', 'n1-08.mp3'),
    ("Good, you're in. Have you got something to write with?", '2244bd78a9dd433199c42a93f4db7070', 'n1-09-v2.mp3'),
    ("St Dymphna's, on Vicarage Road. The public ground's at the top, past the chapel. Section E, row seven, number ten.", 'fd96f578b4e14ea197152226e3c94d21', 'n1-10-v2.mp3'),
    ("Harold Thorp, seventy-eight. Council funeral on Tuesday, and nobody came. He won't be embalmed, the council don't pay for that.", '465edd3b60e04d088d7d4b54e7e55e79', 'n1-11-v2.mp3'),
    ("I want both kidneys. Take them out whole, with as much of the tubes as you can get. Nick one and it's worth half.", '1c82c8fb301b45cba2d00384c420e609', 'n1-12-v2.mp3'),
    ("Make sure it's him before you lift him out. The name plate, the scar on his belly, his ring. They reuse the ground up there.", 'f7ff35f52e3b431cbdd3e10dbb75f19f', 'n1-13-v2.mp3'),
    ("The tools are in the shed behind the chapel. The cold room's through the chapel's east door. I've left it unlocked.", '150d149ffa3b4752bf4f78f2dbf6e796', 'n1-14-v2.mp3'),
    ("Leave him on the table when you've finished. Someone will see to him in the morning.", 'd1b0ab644a9448d7be648213cfe76f45', 'n1-15-v2.mp3'),
    ("Half three, at the service gate on the east wall. Someone will be there with your money. Don't keep them waiting.", '6bb49f7a13704010b747272b8ac5cd8d', 'n1-16-v2.mp3'),
    ("One more thing. The man in the lodge by the gate goes to bed at eleven, but he's a light sleeper.", 'd0653041b58d457bafba6aa52860e528', 'n1-17-v2.mp3'),
    ('Evening. You\'ll be the new one.', 'cc4ffb5d340e4e4d8db0e048873f6b7f', 'n1-18.mp3'),
    ("Pass it through the bars, that's fine. Let's have a look.", '2d4efa0826474234b8f334c935309b96', 'n1-19-v2.mp3'),
    ("Nice and clean. You've done this before.", 'f3b02c0e74754965a6a3d3027edb1532', 'n1-20-v2.mp3'),
    ("You've been careless. I'll pay for what I can use.", '45f02b430c994a38804bfebca4816104', 'n1-21-v2.mp3'),
    ('This is meat. I don\'t pay for meat.', '254fe9d0be4b4b88b655d571887c675c', 'n1-22.mp3'),
    ('Nothing? Then what am I stood here for?', '47b1bee1384440af9c7d484fa0869279', 'n1-23-v2.mp3'),
    ('Your man on the phone says same again next week. Go home and get warm.', '4cf6d2c824e146cbb717f66c34b258b7', 'n1-24-v2.mp3'),
    ("And the old boy in the lodge window has been watching you since one o'clock.", 'c2856281908a4cc7b5dd7cd429f7bb5c', 'n1-25-v2.mp3'),
    ('You have one new message.', '9bea6209ed2a4317a32704b169bd85ec', 'n1-26.mp3'),
    ('They\'ve moved me to Saturdays as well. Four nights a week now. I\'m fine. I\'m fine, it\'s just more.', 'bcdc9485e9d74593b219cc37c9e1f5e1', 'n1-27.mp3'),
    ('Were you out last night? I rang at two. Don\'t be doing anything daft.', '5ce79160aacf49af8f68887793b1714d', 'n1-28.mp3'),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for text, task, file in LINES:
        # Fish gives mp3; the game plays Ogg Vorbis, like every other sound in it.
        kept = os.path.splitext(file)[0] + '.ogg'
        if not os.path.exists(os.path.join(OUT, kept)):
            if not os.path.exists(os.path.join(OUT, file)):
                urllib.request.urlretrieve(FISH.format(task), os.path.join(OUT, file))
            subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', os.path.join(OUT, file), '-c:a', 'libvorbis', '-q:a', '5', os.path.join(OUT, kept)], check=True)
        manifest[text] = kept
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
    print(len(manifest), 'lines')


if __name__ == '__main__':
    main()
