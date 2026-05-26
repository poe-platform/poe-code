# Terminal PNG renders carriage return progress updates as overlapping text

## Summary

`terminal-png` accepts ANSI terminal output for screenshot rendering, but it treats carriage returns as ordinary text rather than cursor movement. Output from progress indicators that rewrite one line with `\r` is rendered with both the old and new contents in the same SVG text run instead of depicting the final visible terminal line.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-png/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";

describe("carriage-return terminal output", () => {
  it("renders both pre-return and replacement text instead of the final terminal line", () => {
    const runs = parseAnsi("loading 0%\rloading 100%\n");
    const svg = renderSvg(runs, { window: false });
    console.log(JSON.stringify({ text: runs.map((run) => run.text).join("") }));
    expect(runs.map((run) => run.text).join("")).toBe("loading 0%\rloading 100%\n");
    expect(svg).toContain("loading 0%\rloading 100%");
  });
});
PROBE
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm packages/terminal-png/src/__probe__.test.ts
```

Output:

```text
{"text":"loading 0%\rloading 100%\n"}
✓ packages/terminal-png/src/__probe__.test.ts > carriage-return terminal output > renders both pre-return and replacement text instead of the final terminal line
```

## Observed Behavior

The public package description states that it renders PNG images from ANSI terminal output in `packages/terminal-png/README.md`. `parseAnsi()` in `packages/terminal-png/src/ansi-parser.ts` recognizes styling CSI sequences but pushes ordinary input characters, including `\r`, into rendered text runs. `renderSvg()` in `packages/terminal-png/src/svg-renderer.ts` splits lines only on `\n` and writes the run text into a single `<tspan>`, so an input line updated using `loading 0%\rloading 100%` is represented as both strings plus a carriage return rather than a terminal line overwritten to `loading 100%`.

## Expected Behavior

When rendering terminal output, carriage return should move the cursor to the beginning of the current line and subsequent characters should replace visible content, matching common progress-bar and spinner behavior. The resulting image should show the final displayed line, not embedded historical rewrite control characters.

## Impact

Screenshots of normal interactive CLI output, downloads, builds, test runners, and spinners can contain corrupted or overlapping progress lines. Visual QA and agent interpretation of rendered terminal captures may misrepresent the application state precisely for commands that use dynamic single-line status updates.
