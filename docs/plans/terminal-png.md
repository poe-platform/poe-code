# Plan: `@poe-code/terminal-screenshot`

Native TypeScript replacement for the `charmbracelet/freeze` Go binary. Produces identical PNG screenshots from ANSI terminal output.

## Use case

`screenshot.ts` currently calls:

```sh
freeze <file> -o <output> --window --padding 20 --language ansi
```

After this package exists, it will import `renderTerminalScreenshot` directly instead of spawning a binary.

## Package: `packages/terminal-screenshot`

**npm name:** `@poe-code/terminal-screenshot`

## API

### Programmatic

```ts
import { renderTerminalScreenshot } from "@poe-code/terminal-screenshot";

const png: Buffer = await renderTerminalScreenshot(ansiText, {
  padding?: number,   // default: [20, 40, 20, 20] (top/right/bottom/left)
  window?: boolean,   // default: true  (macOS chrome)
  output?: string,    // if set, writes file and returns buffer
});
```

### CLI

```sh
terminal-screenshot <input.ansi> -o <output.png> [--window] [--padding 20]
```

Drop-in for the freeze call in `screenshot.ts`.

## Implementation

Three layers, wired together in `src/index.ts`:

### 1. ANSI parser (`src/ansi-parser.ts`)

Hand-written state machine. No external parser lib. Produces:

```ts
type StyledRun = {
  text: string;
  fg: Color | null;
  bg: Color | null;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  dim: boolean;
};

type Color =
  | { type: "ansi4"; index: number }
  | { type: "ansi8"; index: number }
  | { type: "rgb"; r: number; g: number; b: number };
```

### 2. SVG renderer (`src/svg-renderer.ts`)

Walks `StyledRun[]`, emits `<tspan>` elements with inline styles. Adds macOS window chrome when `window: true`.

### 3. PNG rasterizer (`src/png-renderer.ts`)

```ts
import { Resvg } from "@resvg/resvg-js";
// SVG string → PNG Buffer
```

`@resvg/resvg-js` ships prebuilt WASM — no C++ compilation.

## Styling Reference (from charmbracelet/freeze source)

Sourced from `ansi.go`, `configurations/base.json`, and `svg/svg.go` in the freeze repo.

### Font

- Family: `JetBrains Mono`
- Size: `14px`
- Ligatures: `true`

### Layout

- Background: `#171717`
- Line height: `1.2`
- Default padding: `[20, 40, 20, 20]` (top, right, bottom, left)

### macOS window chrome (`window: true`)

- Title bar height addition above text: `15px`
- Traffic-light dot radius: `5.5px`
- Dot cy (vertical center): `12px`
- Dot cx values: `13.5`, `32.5`, `51.5`
- Colors: red `#FF5A54` · yellow `#E6BF29` · green `#52C12B`

### ANSI-16 palette (freeze's custom palette from `ansi.go`)

| SGR | Name           | Hex       |
| --- | -------------- | --------- |
| 30  | black          | `#282a2e` |
| 31  | red            | `#D74E6F` |
| 32  | green          | `#31BB71` |
| 33  | yellow         | `#D3E561` |
| 34  | blue           | `#8056FF` |
| 35  | magenta        | `#ED61D7` |
| 36  | cyan           | `#04D7D7` |
| 37  | white          | `#C5C8C6` |
| 90  | bright black   | `#4B4B4B` |
| 91  | bright red     | `#FE5F86` |
| 92  | bright green   | `#00D787` |
| 93  | bright yellow  | `#EBFF71` |
| 94  | bright blue    | `#8F69FF` |
| 95  | bright magenta | `#FF7AEA` |
| 96  | bright cyan    | `#00FEFE` |
| 97  | bright white   | `#FFFFFF` |

### xterm-256 palette (indices 16–255, hardcoded in freeze `ansi.go`)

- Indices 0–15: the ANSI-16 palette above
- Indices 16–231: 6×6×6 RGB cube — levels `[0, 95, 135, 175, 215, 255]`
- Indices 232–255: grayscale ramp `#080808` → `#eeeeee` in steps of 10

## File layout

```text
packages/terminal-screenshot/
  src/
    ansi-parser.ts
    ansi-parser.test.ts
    svg-renderer.ts
    svg-renderer.test.ts
    png-renderer.ts
    cli.ts
    index.ts
  bin/
    terminal-screenshot
  package.json
  tsconfig.json
  tsconfig.build.json
  README.md
```

## Dependencies

| Package | Why |
| --- | --- |
| `@resvg/resvg-js` | SVG → PNG, WASM, no native compilation |
| `@fontsource/jetbrains-mono` | JetBrains Mono woff2 embedded as base64 `@font-face` — no system font needed |
| `commander` | CLI arg parsing |

## Testing

- Unit tests on the ANSI parser and SVG renderer
- Visual validation: `npm run screenshot-poe-code -- --help` compared against current freeze output

## Visual comparison (agent QA)

`packages/terminal-screenshot/scripts/compare.ts` is run by the pipeline agent as part of QA.
It produces two PNGs and prints their paths to stdout:

```text
FREEZE: /tmp/ts-compare-freeze.png
NEW:    /tmp/ts-compare-new.png
```

The agent reads both images visually, reports layout/colour/font differences, and fixes
any discrepancies before marking the task done. The task is only complete when the two
images are visually equivalent.
