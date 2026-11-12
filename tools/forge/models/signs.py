"""Painted shop fascias: gilt serif capitals with a dark shadow, on the board's own colour, one shop to a row.

    python3 tools/forge/models/signs.py <out.png> <r,g,b> <r,g,b> <r,g,b> <r,g,b>

Run with the system's Python (it needs PIL, which Blender's has not); surfaces.py runs it when the picture is
missing, passing each row's board colour (sRGB, 0..1). The names are made up.
"""

import sys

from PIL import Image, ImageDraw, ImageFilter, ImageFont

SHOPS = [('E. PILLING', 'FAMILY BUTCHER'), ('HOLDEN & SONS', 'IRONMONGERS'), ('M. DUCKWORTH', 'NEWSAGENT'),
         ('A. KERSHAW', 'DISPENSING CHEMIST')]
FONT = '/usr/share/fonts/noto/NotoSerif-Bold.ttf'
ROW = (2765, 256)           # drawn at the board's own proportions (5.4 m by 0.5 m), then squeezed into 1024
GILT, SHADOW = (214, 170, 92), (12, 8, 4)


def row(board, name, trade):
    picture = Image.new('RGB', ROW, tuple(int(c * 255) for c in board))
    font = ImageFont.truetype(FONT, 132)
    small = ImageFont.truetype(FONT, 84)
    text = Image.new('L', ROW, 0)
    draw = ImageDraw.Draw(text)
    left = draw.textlength(name, font=font)
    gap = 90
    right = draw.textlength(trade, font=small)
    x = (ROW[0] - left - gap - right) / 2
    draw.text((x, 50), name, font=font, fill=255)
    draw.text((x + left + gap, 86), trade, font=small, fill=255)
    shadow = text.filter(ImageFilter.GaussianBlur(3)).transform(ROW, Image.AFFINE, (1, 0, -7, 0, 1, -7))
    picture.paste(SHADOW, mask=shadow)
    picture.paste(GILT, mask=text)
    lining = ImageDraw.Draw(picture)
    lining.rectangle((22, 22, ROW[0] - 23, ROW[1] - 23), outline=GILT, width=5)
    return picture.resize((1024, 128), Image.LANCZOS)


def main():
    out, boards = sys.argv[1], [tuple(float(c) for c in arg.split(',')) for arg in sys.argv[2:6]]
    atlas = Image.new('RGB', (1024, 512))
    for i, ((name, trade), board) in enumerate(zip(SHOPS, boards)):
        atlas.paste(row(board, name, trade), (0, i * 128))
    atlas.save(out)


main()
