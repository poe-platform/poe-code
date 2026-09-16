# Run formatting usage draft

`pptx` edits selected runs through the package SDK and `text runs set` operation. Read explicit properties with `text runs get`; omitted properties remain null in this snapshot rather than being flattened to effective inherited values. Supply admitted bytes and an explicit context; loading and saving do not read host paths implicitly.

Formatting options include `font`, `size`, `language`, `bold`, `italic`, `underline`, `strike`, `baseline`, `capitalization`, `spacing`, `color` and `highlight`. A missing option leaves that property unchanged. `null` removes an explicit override so inherited formatting can apply. `false` writes an explicit off value for emphasis. Reading explicit properties is separate from inspecting effective inherited values and their provenance.

Underline accepts documented symbolic or numeric enum values, as well as explicit `true`, `false`, or `null` in the typed operation. Colors accept six hexadecimal digits. The run operation also accepts `{ "rgb": "2468AC", "brightness": 0.25 }` or `{ "theme": "accent2", "brightness": -0.4 }`. Brightness ranges from -1 to 1. A positive value writes luminance modulation and offset; a negative value writes modulation only. Zero removes both adjustments. Highlight uses the same color payload.

`ColorFormat` is a synchronous standalone view over an explicitly supplied bounded XML color container. `rgb`, `theme_color`, `type` and `brightness` use neutral model property names. The `xml` property returns the latest immutable XML revision after a mutation. Missing RGB access raises a property-unavailable error; an existing nonscheme color returns `NOT_THEME_COLOR` for `theme_color`. Missing theme-color access raises. Setting brightness requires an existing color. String color category/theme identifiers are the current bounded API; the complete symbolic enum and live presentation graph remain separate documented gaps.

`RGBColor` validates three integer channels from 0 through 255. `from_string` accepts exactly six hexadecimal digits and `toString()` returns uppercase hexadecimal. Values are immutable and expose `length`, iteration, `equals`, checked `at`, and `slice`. Direct numeric channel positions 0, 1 and 2 are readable; use `at` when bounds validation is needed.

Run edits preserve unselected attributes and extension content. No font installation, font discovery, shaping or rendering is implied. Complete live `Font`/`FillFormat` graph APIs and language enum objects are not claimed by the current byte-operation surface.

```sh
pptx text runs list deck.pptx --slide 1 --json
pptx text runs get deck.pptx --slide 1 --shape Caption --paragraph 1 --run 1 --json
pptx text runs set deck.pptx --slide 1 --shape Caption --paragraph 1 --run 1 \
  --font "Example Sans" --size 18pt --language fr-CA --bold false \
  --underline DOUBLE_LINE --spacing -1pt --highlight FFE080 --output formatted.pptx
```

`list` permits empty results; `get` requires exactly one run. Run setters require an explicit selector or `--all`. Paragraph/run flags are one-based and cannot be combined with an opaque `--select` token. Table/cell selectors are not exposed yet. `--help` on a run command shows formatting and publication options; `schema text runs set --json` describes the closed option schema.

```ts
import { mutateTextRuns, readTextRuns } from "pptx";

const changed = await mutateTextRuns(bytes, {
  select: { kind: "slide", position: { coordinateSystem: "one-based", value: 1 } },
  shape: "Caption",
  paragraph: 0,
  run: 0,
  font: "Example Sans",
  size: 18,
  bold: false,
  italic: null,
  color: { theme: "accent2", brightness: -0.25 }
}, context);
const runs = await readTextRuns(changed.bytes, {}, context);
```

The caller supplies `bytes` and bounded `context`; SDK size and spacing are points, baseline is percent, and SDK paragraph/run indexes are zero-based. `readTextRuns` returns immutable-style snapshots rather than live presentation graph handles. The returned direct properties use `null` for absence. `inspect` separately reports effective inherited values, their source and unresolved tokens.
