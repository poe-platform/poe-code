# Plan: `@poe-code/ansi-screenshot`

Native TypeScript replacement for the `charmbracelet/freeze` Go binary. Produces identical PNG screenshots from ANSI terminal output.

## Use case

`screenshot.ts` currently calls:

```sh
freeze <file> -o <output> --window --padding 20 --language ansi
```

After this package exists, it will import `renderAnsiScreenshot` directly instead of spawning a binary.

## Package: `packages/ansi-screenshot`

**npm name:** `@poe-code/ansi-screenshot`

## API

### Programmatic

```ts
import { renderAnsiScreenshot } from "@poe-code/ansi-screenshot";

const png: Buffer = await renderAnsiScreenshot(ansiText, {
  padding?: number,   // default: 20
  window?: boolean,   // default: true  (macOS chrome)
  output?: string,    // if set, writes file and returns buffer
});
```

### CLI

```sh
ansi-screenshot <input.ansi> -o <output.png> [--window] [--padding 20]
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

Walks `StyledRun[]`, emits `<tspan>` elements with inline styles. Adds macOS window chrome when `window: true` (title bar + three traffic-light dots). Defaults: 14px monospace, `#1e1e2e` background, 1.5 line height.

### 3. PNG rasterizer (`src/png-renderer.ts`)

```ts
import { Resvg } from "@resvg/resvg-js";
// SVG string → PNG Buffer
```

`@resvg/resvg-js` ships prebuilt WASM — no C++ compilation.

## File layout

```text
packages/ansi-screenshot/
  src/
    ansi-parser.ts
    ansi-parser.test.ts
    svg-renderer.ts
    svg-renderer.test.ts
    png-renderer.ts
    cli.ts
    index.ts
  bin/
    ansi-screenshot
  package.json
  tsconfig.json
  tsconfig.build.json
  README.md
```

## Dependencies

| Package | Why |
|---|---|
| `@resvg/resvg-js` | SVG → PNG, WASM, no native compilation |
| `commander` | CLI arg parsing |

## Testing

- Unit tests on the ANSI parser and SVG renderer
- Visual validation: `npm run screenshot-poe-code -- --help` compared against current freeze output

## Open question

Exact ANSI-16 color palette freeze uses needs a side-by-side pixel comparison to confirm (likely standard xterm-256 table). Resolve during implementation.
