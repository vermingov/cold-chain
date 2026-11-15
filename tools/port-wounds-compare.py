# The Bevy port's wounds check against the TS game's (tools/port-wounds.mjs): every shot, every reading, what differs
# beyond rounding, and the cries each made.
#   python3 tools/port-wounds-compare.py ts.json log.json
import json, sys
ts = json.load(open(sys.argv[1]))['results']
rs = json.load(open(sys.argv[2]))['log']
snaps = {}
for e in rs:
    w = e['what']
    if w.get('event') == 'vitals': snaps.setdefault(w['name'], []).append(w['snap'])
def same(a, b):
    if isinstance(a, (int, float)) and isinstance(b, (int, float)) and not isinstance(a, bool):
        return abs(a - b) <= 0.0011 + 2e-4 * abs(a)
    if isinstance(a, dict) and isinstance(b, dict): return a.keys() == b.keys() and all(same(a[k], b[k]) for k in a)
    if isinstance(a, list) and isinstance(b, list): return len(a) == len(b) and all(same(x, y) for x, y in zip(a, b))
    return a == b
total = matched = 0
for t in ts:
    name = t['shot']['name']
    bad = []
    for a, b in zip(t['series'], snaps[name]):
        for k in a:
            if k == 'log': continue
            total += 1
            if k == 'injuries':
                ok = sorted(i[0] for i in a[k]) == sorted(i[0] for i in b[k]) and same(sorted(a[k]), sorted(b[k]))
            else:
                ok = same(a[k], b[k])
            if ok: matched += 1
            else: bad.append((a['t'], k, a[k], b[k]))
    shot = next(e['what'] for e in rs if e['what'].get('event') == 'shot' and e['what']['name'] == name)
    dt = [x for x in t['res'] if isinstance(x, str)]; dr = [x for x in shot['result']['res'] if isinstance(x, str)]
    print(f"{name}: {'all readings match' if not bad else str(len(bad)) + ' differ'}; after the shot TS {dt}, port {dr}")
    for x in bad[:12]: print('   t=%s %s\n      TS %s\n      RS %s' % x)
    says_t = [(s['t'], [l for l in s['log'] if l.startswith('say')]) for s in t['series']]
    says_r = [(s['t'], [l for l in s['log'] if l.startswith('say')]) for s in snaps[name]]
    print('   cries TS', [x for x in says_t if x[1]], '\n   cries RS', [x for x in says_r if x[1]])
print(f'{matched}/{total} readings match')
