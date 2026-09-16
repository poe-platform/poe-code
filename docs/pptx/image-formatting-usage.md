# Picture sizing and formatting (draft)

These are local workspace APIs; no published package availability is implied.

```ts
import { addImage, setImage } from "pptx";

const inserted = await addImage(
  presentationBytes,
  {
    slide: 1,
    bytes: imageBytes,
    contentType: "image/png",
    left: 914400,
    top: 914400,
    width: 1828800,
    height: 914400,
    fit: "cover"
  },
  context
);
const edited = await setImage(
  inserted,
  { slide: 1, image: 1 },
  {
    cropLeft: -0.1,
    cropRight: 0.2,
    rotation: 27.125,
    flipHorizontal: true,
    flipVertical: false,
    opacity: 0.625,
    borderColor: "2468AC",
    borderWidth: 25400
  },
  context
);
// edited.bytes contains the complete validated presentation.
```

`context` supplies byte, archive, XML and relationship limits plus optional
cancellation. Inputs are admitted bytes/streams or explicit VFS capabilities.
There is no ambient filesystem, image decoder process or network access.

Native sizing uses characterized dimensions and DPI. One dimension preserves
aspect ratio. Two dimensions default to stretch; contain centers uncropped media
inside the box, and cover centers cropped media to fill it. A specified fit needs
both dimensions. All SDK geometry is integer EMU. CLI lengths carry explicit
units (`emu`, `in`, `cm`, `mm`, `pt`). Computed geometry rounds nearest, ties away
from zero, and rejects zero-sized output or a cover crop rounded to empty.

```sh
pptx images add deck.pptx --slide 1 --file coast.png --width 4in --height 2in --fit contain -o inserted.pptx
pptx images set inserted.pptx --slide 1 --image 1 --crop-left -0.1 --crop-right 0.2 --rotation 27.125 --flip-horizontal true --opacity 0.625 --border-color 2468AC --border-width 2pt -o formatted.pptx
pptx images set formatted.pptx --slide 1 --image 1 --opacity 0 --dry-run --json
pptx schema images set
```

Crop sides are signed fractions in [-21474.83648, 21474.83647], quantized to
1/100000 with ties away from zero. Negative and greater-than-one sides are
permitted when the resulting `1-left-right` and `1-top-bottom` remain positive.
Crop edits reject a zero or negative visible axis after quantization. Reads and
unrelated formatting edits preserve existing crop values, even if an existing
rectangle has no visible area. Untouched side spellings and source media bytes
are retained. Opacity writes the blip alpha multiplier in 1/100000 units; other
existing effects remain intact and can also affect final rendering.

Rotation normalizes modulo 360 in 1/60000-degree units. Explicit false flips,
zero opacity, zero crop, and zero outline width are meaningful values. Outline
colors are six hexadecimal digits; widths range from 0 to 20116800 EMU.
Partial outline edits preserve other line properties.

Selection is one-based by slide/image, or uses a current fingerprinted token.
Use `all: true` / `--all` for all pictures within explicit scope and `allowEmpty`
/ `--allow-empty` for a permitted no-match edit. Formatting affects occurrences,
not shared media. Fill/background occurrences and vector fallback bindings are
not picture-formatting targets. Mutation publication follows common output,
force, in-place and dry-run rules.

The operation surface is implemented; the complete live `Picture` object model
and its documented snake_case properties remain tracked separately in the
[API evidence](image-formatting-evidence.md). This draft does not claim whole-API
coverage or whole-slide rendering fidelity.
