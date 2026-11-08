"""Regenerate assets/terminal-glyph-fallback.ttf with fonttools 4.60.2.

Source: https://github.com/google/fonts/blob/main/ofl/notosanssc/NotoSansSC%5Bwght%5D.ttf
Source SHA-256: a3041811a78c361b1de50f953c805e0244951c21c5bd412f7232ef0d899af0da
License: ../assets/OFL.txt
Usage: python subset-fallback-font.py /path/to/NotoSansSC.ttf
Only this offline asset-generation script needs fonttools; rendering does not.
"""
import sys
from pathlib import Path

from fontTools import subset
from fontTools.pens.transformPen import TransformPen
from fontTools.pens.ttGlyphPen import TTGlyphPen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont

font = TTFont(sys.argv[1])
subsetter = subset.Subsetter()
subsetter.populate(unicodes=[0x25D0, 0x25D1, 0x25D2, 0x25D3, 0x754C])
subsetter.subset(font)
font = instantiateVariableFont(font, {"wght": 400}, inplace=True)
# Fit circles into a single monospace cell, keeping their vertical center.
for codepoint in range(0x25D0, 0x25D4):
    name = font.getBestCmap()[codepoint]
    pen = TTGlyphPen(None)
    font.getGlyphSet()[name].draw(TransformPen(pen, (0.6, 0, 0, 0.6, 0, 160)))
    font["glyf"][name] = pen.glyph()
    font["glyf"][name].recalcBounds(font["glyf"])
    font["hmtx"][name] = (600, font["glyf"][name].xMin)
for record in font["name"].names:
    if record.nameID in (1, 3, 4, 6, 16):
        name = "TerminalGlyphFallback" if record.nameID == 6 else "Terminal Glyph Fallback"
        record.string = name.encode(record.getEncoding())
font.save(Path(__file__).resolve().parent.parent / "assets/terminal-glyph-fallback.ttf")
