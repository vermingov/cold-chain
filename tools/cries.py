"""The people's cries: what the men in the sandbox sound like when they are hurt.

    python3 tools/cries.py        fetch whatever is missing into assets/cries (needs ffmpeg)

Each was performed by Fish Audio's acting model (drama-3) from a direction,
several takes to a file with a long pause between them: the game plays one
burst of a file at a time (src/sound.ts), so each take is heard on its own.
Generated once (every generation costs credits); what is kept here is where
each file is, so building again is a download and never another charge.
`manifest.json` maps a sound's name ("scream-oldman") to its file.
"""

import json
import os
import subprocess
import urllib.request

OUT = os.path.join(os.path.dirname(__file__), '..', 'assets', 'cries')
FISH = 'https://platform.r2.fish.audio/tasks/2026-11-13/{}.mp3'

# Whose voice each body has (Fish Audio voice ids).
VOICES = {
    'oldman': '5e79e8f5d2b345f98baa8c83c947532d',   # Paddington: British, old, deep
    'sexton': 'b7204d4e40ef4a548c7c8547b7f73492',   # Alok: British, middle-aged
    'buyer': '711cf3ed00ab441a8f54a45058047b7a',    # Verity: young, expressive
}

# What each kind of cry was asked for (the same direction for every voice).
ASKED = {
    'scream': '[screaming in agony] AAAAAGH! [long pause] [howling in pain, ragged] AAAHHH! AAAAH! [long pause] [a sudden shriek of terrible pain] NNAAAAGH!',
    'yell': '[sharp cry of pain] Agh! [long pause] [grunting, hit hard] Ugh! [long pause] [yelping in pain] Ah! [long pause] [pained shout through gritted teeth] Hngh! [long pause] [winded by a blow] Oof!',
    'groan': '[groaning in pain, low] Nnnngh... [long pause] [moaning, badly hurt] Uhhhh... [long pause] [a long pained groan] Hhhnnnngh...',
    'cry': '[sobbing in pain and fear] Oh god... oh god... [long pause] [weeping, whimpering] Please... please... [long pause] [crying, breathless] Hhh... hhh... help me...',
    'gasp': '[gasping for air, wheezing] Hhh... hhh... [long pause] [struggling to breathe, panicked gasps] Hah... hah... hah...',
    'cough': '[coughing wetly, choking on blood] Khh! Khhh! [long pause] [a wet, gurgling cough] Hkk... khh!',
    'dying': '[a last rattling breath, fading] Hhhhhh... [long pause] [dying, a weak final exhale] Hhhh...',
}

# The Fish task each file was made in: TASKS[body][kind].
TASKS = {
    'buyer': {'scream': '13ce24e84c204ec1998505eaa3f5637a', 'yell': '695c38e93e744a009dcb4b50a44b1a4f', 'groan': '8afa2ce2401348688222cf49b422f3ad',
              'cry': '6585da203401426db65fca519155abef', 'gasp': '84e83a4b70d8458bb69e83db591fd0ce', 'cough': 'f850836660e54ca4a51e98f2c219af7a',
              'dying': '9c400259b84e4c2c9c3ad1a4876cd6c2'},
    'oldman': {'scream': 'a499792b910841dead9527647a5b1c13', 'yell': '2081cd83379e47b7902c588a73213181', 'groan': '18947f02e63f4fb8ba08d88c700a2f7a',
               'cry': '04c4baa8507c408c926cb2eb6c1115c5', 'gasp': 'c7ae4b712510418e9c08a0de61e6c3ee', 'cough': '5736eff148eb4cc1a927e6211e6d30e0',
               'dying': '4af04183fb054a88ac586ef7a6159416'},
    'sexton': {'scream': '49f3392c730c42ac9693a998fb297ed9', 'yell': 'b4a31ea9aa504735a0b10eccb0dd933f', 'groan': '54527d56f9c2425d9e6f7d93e9ef63b2',
               'cry': '445eafc23ba44349aef3c9c313a52a8f', 'gasp': 'e2e3022e5c8343ba9a416384d262bbab', 'cough': 'a464e763152e42eb9b4c5a1dbc630a60',
               'dying': 'd1a1c8a4593c4c19bad775e5b8a98b7d'},
}


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for body, kinds in TASKS.items():
        for kind, task in kinds.items():
            name = f'{kind}-{body}'
            ogg = os.path.join(OUT, name + '.ogg')
            if not os.path.exists(ogg):
                mp3 = ogg[:-4] + '.mp3'
                urllib.request.urlretrieve(FISH.format(task), mp3)
                subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', mp3, '-ac', '1', '-c:a', 'libvorbis', '-q:a', '5', ogg], check=True)
                os.remove(mp3)
            manifest[name] = [name + '.ogg']
    json.dump(manifest, open(os.path.join(OUT, 'manifest.json'), 'w'), indent=1)
    print(f'{len(manifest)} cries in {OUT}')


if __name__ == '__main__':
    main()
