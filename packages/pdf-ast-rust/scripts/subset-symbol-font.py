"""Regenerate the static symbol and CJK fallbacks using fonttools 4.56.0.

Source: https://github.com/google/fonts/blob/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf
This is the same pinned source used by terminal-png's glyph fallback.
License: ../src/fonts/LICENSE.NotoSansSC
Usage: python3 scripts/subset-symbol-font.py /path/to/NotoSansSC.ttf
Only this offline asset-generation script needs fonttools; rendering does not.
"""
import hashlib
import io
import sys
from pathlib import Path

from fontTools import subset
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

source = Path(sys.argv[1]).read_bytes()
expected = "a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da"
if hashlib.sha256(source).hexdigest() != expected:
    raise SystemExit("Noto Sans SC source SHA-256 does not match the pinned font")
for name, ranges in [
    ("Symbol", [(0x2000, 0x2C00)]),
    ("Cjk", [(0x3000, 0x3100), (0x3400, 0x4DC0), (0x4E00, 0xA000),
             (0xF900, 0xFB00), (0xFF01, 0xFF61)]),
]:
    font = TTFont(io.BytesIO(source), recalcTimestamp=False)
    subsetter = subset.Subsetter()
    subsetter.populate(unicodes=[point for start, end in ranges for point in range(start, end)])
    subsetter.subset(font)
    font = instantiateVariableFont(font, {"wght": 400}, inplace=True)
    for record in font["name"].names:
        if record.nameID in (1, 3, 4, 6, 16):
            family = f"Document{name}Fallback" if record.nameID == 6 else f"Document {name} Fallback"
            record.string = family.encode(record.getEncoding())
    font.save(Path(__file__).resolve().parent.parent / f"src/fonts/Document{name}Fallback.ttf")
