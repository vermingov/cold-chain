"""Give every texture of the weapons' glTF (assets/models/weapons/*.glb) a plain `source` as well as its
EXT_texture_webp one, and make that extension optional rather than required.

The forge's models carry their images as WebP through EXT_texture_webp, which Babylon reads and Bevy's glTF loader
does not (it rejects a file that requires the extension, and a texture with no `source`). The core `source` is the
spec's fallback for loaders without the extension; pointed at the same WebP image, Bevy (built with its `webp` feature)
decodes it, and Babylon goes on using the extension as before. Only the JSON chunk changes; run it again after the
models are rebuilt. Idempotent.

    python3 tools/gltf-fallback.py
"""
import glob
import json
import struct


def fix(path):
    data = open(path, 'rb').read()
    magic, version, _ = struct.unpack('<4sII', data[:12])
    assert magic == b'glTF' and version == 2, path
    length, kind = struct.unpack('<I4s', data[12:20])
    assert kind == b'JSON', path
    doc = json.loads(data[20:20 + length])
    rest = data[20 + length:]
    changed = False
    for t in doc.get('textures', []):
        webp = t.get('extensions', {}).get('EXT_texture_webp')
        if webp and t.get('source') != webp['source']:
            t['source'] = webp['source']
            changed = True
    required = doc.get('extensionsRequired', [])
    if 'EXT_texture_webp' in required:
        required.remove('EXT_texture_webp')
        if not required:
            del doc['extensionsRequired']
        changed = True
    if not changed:
        return False
    chunk = json.dumps(doc, separators=(',', ':')).encode()
    chunk += b' ' * (-len(chunk) % 4)
    body = struct.pack('<I4s', len(chunk), b'JSON') + chunk + rest
    open(path, 'wb').write(struct.pack('<4sII', b'glTF', 2, 12 + len(body)) + body)
    return True


if __name__ == '__main__':
    for path in sorted(glob.glob('assets/models/weapons/*.glb')):
        print(path, 'fixed' if fix(path) else 'already')
