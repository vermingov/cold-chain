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

# Night one: the text as story.js has it, and the Fish task it was generated in.
LINES = [
    ('You have two new messages. First new message.', '46e72d90a7994506ad3d71d6e2a39350'),
    ('Hiya. It\'s me. They had me on for four hours again because the line kept alarming.', '363f720c777d4c268f406c2122655083'),
    ('The arm\'s gone a funny colour round the fistula. The nurse says it\'s fine. She said it like it isn\'t.', '6fa5fcb1bd3e4a9b8c1f6cdf21b8d973'),
    ('Don\'t ring back tonight, I\'m knackered. Love you. Eat something.', '2fd8c9bea59c4f3b8a51cc52aac0e530'),
    ('Next new message.', '005657aee83d4ba8bcc309b5e75991cf'),
    ('This is Joanne from Holbeck Clinic for Dr Anand. We still haven\'t received the deposit for Miss Elin\'s assessment.', '6a2e15cc8f41416c9bffd0f377fa2a90'),
    ('The slot is held until the nineteenth. After that it goes to the next family. Please do call us.', 'f4889db480be4165a42f31025ff69b25'),
    ('End of messages.', 'c56b1cbec8224ec8af6f2a40db4639ff'),
    ('You\'re in. Good. Have you something to write with.', 'b39608fd7039474a95b9681d86d73eb7'),
    ('St Dymphna\'s. Vicarage Road. The public ground at the top, past the chapel. Section E, row seven, number ten.', '3ed8458b10a14fefa99dd595248b3d9e'),
    ('Harold Thorp. Seventy-eight. Council funeral on Tuesday, nobody came. No embalming, they don\'t pay for it.', '9859a61dec1d451a9df8390b337ac35b'),
    ('Both kidneys. Lift them whole, with as much of the tubes as you can. A nick in one and it is worth half.', '234eb94b2ef3415ebb441516e8c3f672'),
    ('Check him before you lift him. The plate, the scar on his belly, the ring. The ground up there gets reused.', '385aa04450c746fcad06ca300b96f78f'),
    ('The tools are in the store behind the chapel. The cold room is the east door of the chapel. It is not locked tonight.', '75b63e993a2d465cad8cb92446bdc0d6'),
    ('Leave him on the table when you are done. That is seen to in the morning.', 'fb5b1173ba81467e92714377766f56d1'),
    ('Half three, the service gate on the east wall. Somebody will be there with the money. Don\'t make them wait.', 'b1036d133b4f44e5b41166860e4fa328'),
    ('And the man in the lodge by the gate goes to bed at eleven. He sleeps lightly.', 'b264dc342e464f1ba8ad19319b22dca0'),
    ('Evening. You\'ll be the new one.', 'cc4ffb5d340e4e4d8db0e048873f6b7f'),
    ('Through the bars is fine. Let\'s have a look at him.', '2cda9b02e2e349cb83a1d00b929143d8'),
    ('Nice. Clean. You\'ve done this before.', '2be2f617e49a4ae08075533770133aa1'),
    ('Somebody\'s been careless. I\'ll pay for what I can use.', '6cb2e2bfc4e444de9124537b6ca7a82f'),
    ('This is meat. I don\'t pay for meat.', '254fe9d0be4b4b88b655d571887c675c'),
    ('Then why am I stood here.', 'f80861fb1f2b42b98030ba780fe785a4'),
    ('Same again next week, he says. Go home, get warm.', '53c3e616a61c4f68a956c28c16bb90c2'),
    ('And whoever that is in the lodge window, he\'s been watching you since one.', '3a032c25cdab4d688972a9fb6cf00354'),
    ('You have one new message.', '9bea6209ed2a4317a32704b169bd85ec'),
    ('They\'ve moved me to Saturdays as well. Four nights a week now. I\'m fine. I\'m fine, it\'s just more.', 'bcdc9485e9d74593b219cc37c9e1f5e1'),
    ('Were you out last night? I rang at two. Don\'t be doing anything daft.', '5ce79160aacf49af8f68887793b1714d'),
]


def main():
    os.makedirs(OUT, exist_ok=True)
    manifest = {}
    for n, (text, task) in enumerate(LINES):
        file = f'n1-{n + 1:02}.mp3'
        if not os.path.exists(os.path.join(OUT, file)):
            urllib.request.urlretrieve(FISH.format(task), os.path.join(OUT, file))
        manifest[text] = file
    with open(os.path.join(OUT, 'manifest.json'), 'w') as f:
        json.dump(manifest, f, indent=1, ensure_ascii=False)
    print(len(manifest), 'lines')


if __name__ == '__main__':
    main()
