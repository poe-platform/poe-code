# GIF decoder fixtures

Palette, interlaced, transparency, animation-first, and disposal fixtures were independently encoded and read with Pillow. PNG references preserve the expected visible pixels; RGB values underneath zero alpha are ignored.

Offset-frame PNG references come from Chrome canvas rendering. The decoder retains the GIF logical canvas and leaves pixels outside the first displayed frame transparent, even without a transparency extension. Native Pandoc backends disagree on this edge: wkhtmltopdf/Qt fills unpainted areas from the global background palette (or opaque black without one), while the TeX image conversion crops to the image descriptor. Pillow fills opaque unpainted areas with palette index zero. These are deliberate comparison differences, not claimed pixel parity.

The three-frame disposal fixtures distinguish restoring the declared background (method 2) from restoring the prior composited frame (method 3), with and without declared transparency. Their PNG references are Pillow frame 0, 1, and 2.

The dictionary-growth fixture uses Pillow with a fixed-seed 128×96 palette raster to exercise GIF LZW code-width growth through 12 bits and dictionary resets.
