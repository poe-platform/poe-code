---
kind: pipeline
version: 1
tasks:
  - id: scaffold
    title: Package scaffold
    prompt: >
      Create `packages/terminal-screenshot` as a new workspace package.


      npm name: `@poe-code/terminal-screenshot`


      Required files:
        - `package.json` — name, version 0.1.0, type module, exports `./dist/index.js`, bin entry `terminal-screenshot → ./bin/terminal-screenshot`, dependencies: `@resvg/resvg-js`, `commander`, `@fontsource/jetbrains-mono`
        - `tsconfig.json` — extends root tsconfig, includes `src/**/*`
        - `tsconfig.build.json` — extends tsconfig.json, outDir `dist`, excludes test files
        - `README.md` — package name, one-sentence description, API section showing `renderTerminalScreenshot` import and options, CLI usage `terminal-screenshot <input.ansi> -o <output.png> [--window] [--padding 20]`
        - `src/index.ts` — empty barrel (filled in later)
        - `bin/terminal-screenshot` — shebang + import from dist/cli.js

      Register the package in the root workspace (`package.json` workspaces array or
      pnpm-workspace.yaml — match how the other packages under `packages/` are registered).


      Do not implement any logic in this task.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: ansi-parser
    title: ANSI parser
    prompt: >
      Implement `packages/terminal-screenshot/src/ansi-parser.ts`.


      Write a hand-written state machine that parses ANSI escape sequences from a string. No
      external parser library.


      Output types:


      ```ts

      export type Color =
        | { type: "ansi4"; index: number }   // 0–15 from SGR 30-37 / 90-97 / 40-47 / 100-107
        | { type: "ansi8"; index: number }   // 38;5;n or 48;5;n
        | { type: "rgb"; r: number; g: number; b: number }; // 38;2;r;g;b or 48;2;r;g;b

      export type StyledRun = {
        text: string;
        fg: Color | null;
        bg: Color | null;
        bold: boolean;
        italic: boolean;
        underline: boolean;
        dim: boolean;
      };


      export function parseAnsi(input: string): StyledRun[] {}

      ```


      Requirements:
        - Split input on newlines, represent `\n` as a run with `text: "\n"` and current style
        - Handle SGR reset (ESC[0m or ESC[m) — resets all attributes
        - Handle bold (1), dim (2), italic (3), underline (4)
        - Handle fg ansi4 (30-37 standard, 90-97 bright), bg ansi4 (40-47, 100-107)
        - Handle fg ansi8 (38;5;n), bg ansi8 (48;5;n)
        - Handle fg rgb (38;2;r;g;b), bg rgb (48;2;r;g;b)
        - Ignore unknown escape sequences without throwing
        - Merge adjacent runs with identical styles

      Color palettes (from freeze's ansi.go — use these exact values):


      ANSI-16 (indices 0-15, used for ansi4 colors):
        0  #282a2e   1  #D74E6F   2  #31BB71   3  #D3E561
        4  #8056FF   5  #ED61D7   6  #04D7D7   7  #C5C8C6
        8  #4B4B4B   9  #FE5F86  10  #00D787  11  #EBFF71
       12  #8F69FF  13  #FF7AEA  14  #00FEFE  15  #FFFFFF

      xterm-256 (indices 16-255, used for ansi8 colors):
        - Indices 0-15: ANSI-16 palette above
        - Indices 16-231: 6×6×6 RGB cube, levels [0, 95, 135, 175, 215, 255]
          index 16+i where i=r*36+g*6+b, each of r/g/b in 0..5
        - Indices 232-255: grayscale #080808 → #eeeeee, step 10 per index

      Also write `packages/terminal-screenshot/src/ansi-parser.test.ts` with unit tests covering:
        - Plain text (no escapes) → single run
        - Bold text
        - fg ansi4 color
        - fg ansi8 color
        - fg rgb color
        - Background color
        - Nested style change then reset
        - Multiline input
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: font-embed
    title: Embed JetBrains Mono font
    prompt: |
      Add `@fontsource/jetbrains-mono` as a regular dependency of
      `packages/terminal-screenshot`.

      Create `packages/terminal-screenshot/src/font.ts`:

      ```ts
      import { readFileSync } from "node:fs";
      import { join } from "node:path";
      import { fileURLToPath } from "node:url";

      // Resolve the woff2 file from the installed @fontsource package at import time.
      // This runs once and the result is module-level, so no per-render I/O.
      const fontPath = join(
        fileURLToPath(import.meta.url),
        "../../node_modules/@fontsource/jetbrains-mono/files/jetbrains-mono-latin-400-normal.woff2",
      );

      export const JETBRAINS_MONO_BASE64 = readFileSync(fontPath).toString("base64");

      export const FONT_FACE_CSS = `@font-face {
        font-family: 'JetBrains Mono';
        font-style: normal;
        font-weight: 400;
        src: url('data:font/woff2;base64,${JETBRAINS_MONO_BASE64}') format('woff2');
      }`;
      ```

      The svg-renderer will import `FONT_FACE_CSS` and inject it into the SVG `<defs>` /
      `<style>` block so every rendered PNG carries the font and needs no system fonts.

      Verify the woff2 file path is correct by checking what files `@fontsource/jetbrains-mono`
      actually ships — the exact filename may differ, adjust accordingly.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: svg-renderer
    title: SVG renderer
    prompt: >
      Implement `packages/terminal-screenshot/src/svg-renderer.ts`.


      ```ts

      export interface SvgOptions {
        padding?: number;   // default 20
        window?: boolean;   // default true — macOS chrome
      }


      export function renderSvg(runs: StyledRun[], options?: SvgOptions): string {}

      ```


      Import `StyledRun` and `Color` from `./ansi-parser`.

      Import `FONT_FACE_CSS` from `./font` and inject it into a `<style>` block inside `<defs>`.

      The SVG must never reference a system font — the embedded font is the only source.


      Rendering rules (exact values from charmbracelet/freeze source):
        - Font: `JetBrains Mono`, 14px, ligatures enabled
        - Background: `#171717`
        - Line height: `1.2`
        - Default padding: top=20, right=40, bottom=20, left=20 (matches freeze base.json)
        - Wrap all text in a `<svg>` with computed width/height
        - Each `StyledRun` becomes a `<tspan>` with inline `fill`, `font-weight`, `font-style`, `text-decoration`, `opacity` (0.7 when dim)
        - Newline runs (`text: "\n"`) advance `dy` by 1.2em, reset `x` to the text start x
        - Color resolution uses the freeze palettes defined in the ansi-parser task:
          - `ansi4`: look up index in ANSI-16 palette
          - `ansi8`: look up index in xterm-256 palette
          - `rgb`: emit `rgb(r,g,b)` directly
        - When `window: true`, prepend macOS window chrome above the text area:
          - Title bar height addition: 15px above the top padding
          - Three traffic-light dots: r=5.5, cy=12
            cx values: 13.5 (red #FF5A54), 32.5 (yellow #E6BF29), 51.5 (green #52C12B)
        - The `padding` option overrides all four sides uniformly when provided as a number

      Write `packages/terminal-screenshot/src/svg-renderer.test.ts` with unit tests covering:
        - Plain text run produces a `<tspan>` with correct content
        - Bold run adds `font-weight:bold`
        - fg color is applied as `fill`
        - `window: false` skips the title bar
        - `window: true` includes traffic-light circles
        - Padding is reflected in the SVG viewBox / dimensions
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: png-renderer
    title: PNG rasterizer
    prompt: |
      Implement `packages/terminal-screenshot/src/png-renderer.ts`.

      ```ts
      import { Resvg } from "@resvg/resvg-js";

      export function renderPng(svg: string): Buffer {
        const resvg = new Resvg(svg);
        const png = resvg.render();
        return Buffer.from(png.asPng());
      }
      ```

      `@resvg/resvg-js` ships prebuilt WASM, no native compilation needed.

      No tests required for this file — it is a thin wrapper over the external library.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: index-and-cli
    title: Public API + CLI
    prompt: >
      Wire the three layers together and expose the public API.


      **`packages/terminal-screenshot/src/index.ts`**


      ```ts

      import { parseAnsi } from "./ansi-parser.js";

      import { renderSvg } from "./svg-renderer.js";

      import { renderPng } from "./png-renderer.js";

      import { writeFile } from "node:fs/promises";


      export interface TerminalScreenshotOptions {
        padding?: number;   // default 20
        window?: boolean;   // default true
        output?: string;    // if set, writes file and returns buffer
      }


      export async function renderTerminalScreenshot(
        ansiText: string,
        options?: TerminalScreenshotOptions,
      ): Promise<Buffer> {
        const runs = parseAnsi(ansiText);
        const svg = renderSvg(runs, { padding: options?.padding, window: options?.window });
        const png = renderPng(svg);
        if (options?.output) {
          await writeFile(options.output, png);
        }
        return png;
      }

      ```


      **`packages/terminal-screenshot/src/cli.ts`**


      Use `commander` to implement:


      ```

      terminal-screenshot <input> -o <output> [--window] [--no-window] [--padding <n>]

      ```


      - Read the input file as UTF-8

      - Call `renderTerminalScreenshot` with the parsed options

      - Exit 1 with a clear error message on any failure


      Export `main()` and call it at the bottom of the file when the module is the entry point.


      Update `packages/terminal-screenshot/src/index.ts` to export `renderTerminalScreenshot` and
      `TerminalScreenshotOptions`.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: visual-comparison
    title: Side-by-side visual comparison (agent QA)
    prompt: |
      Create `packages/terminal-screenshot/scripts/compare.ts`.

      This script is run by the agent as part of QA — not for a human to open manually.
      It produces two PNG files and prints their paths to stdout so the agent can read
      and visually compare them.

      Steps:
        1. Capture ANSI output of `poe-code --help` by spawning the command with
           `FORCE_COLOR=1` and collecting stdout.
        2. Write the ANSI text to a temp file.
        3. Produce the reference PNG by spawning:
             `freeze <tmpfile> -o /tmp/ts-compare-freeze.png --window --padding 20 --language ansi`
           If `freeze` is not on PATH, print "FREEZE_UNAVAILABLE" and skip.
        4. Produce the new PNG by calling
             `renderTerminalScreenshot(ansiText, { window: true, padding: 20 })`
           and writing it to `/tmp/ts-compare-new.png`.
        5. Print to stdout:
             FREEZE: /tmp/ts-compare-freeze.png
             NEW:    /tmp/ts-compare-new.png

      Add an npm script to `packages/terminal-screenshot/package.json`:
        `"compare": "tsx scripts/compare.ts"`

      **Agent QA instructions (for the test step of this task):**
        1. Build the package: `npm run build` inside `packages/terminal-screenshot`.
        2. Run `npm run compare` and capture the output paths.
        3. Read both PNG files using the Read tool to view them visually.
        4. Compare the two images and report:
           - Overall layout match (window chrome, background colour, padding)
           - Font rendering differences
           - Any colour discrepancies in the text
           - Any clipping, overflow, or alignment issues
        5. If differences are found, open issues in the svg-renderer or ansi-parser
           and fix them before marking this task done.
        6. Only mark the task done when the two images are visually equivalent.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
  - id: integrate-screenshot
    title: Replace freeze with renderTerminalScreenshot
    prompt: >
      Find the file in the `packages/` tree that currently spawns the `freeze` binary to produce PNG
      screenshots from ANSI output (search for `freeze` in shell command strings).


      Replace that shell invocation with a direct call to `renderTerminalScreenshot` from
      `@poe-code/terminal-screenshot`:


      ```ts

      import { renderTerminalScreenshot } from "@poe-code/terminal-screenshot";


      const png = await renderTerminalScreenshot(ansiContent, {
        padding: 20,
        window: true,
        output: outputPath,
      });

      ```


      Remove the freeze-spawning code entirely. Add `@poe-code/terminal-screenshot` to the consuming
      package's `package.json` dependencies.


      Visual validation: run `npm run screenshot-poe-code -- --help` and confirm the PNG renders
      correctly before committing.
    status:
      implement: done
      refactor: done
      test: done
      commit: done
---

# terminal png

Archived local pipeline plan converted from YAML during docs cleanup.
