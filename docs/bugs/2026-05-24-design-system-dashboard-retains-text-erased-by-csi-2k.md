# Design system dashboard retains text erased by CSI 2K

## Summary

The design-system dashboard discards non-SGR ANSI CSI sequences instead of applying their screen effects. In particular, output ending with `CSI 2 K` (erase the entire current line) still renders all text that the terminal application explicitly erased, so cleared transient status content remains visible in the dashboard.

## Reproduction

From the repository root, run a disposable Vitest probe against the dashboard output path:

```sh
cat > packages/design-system/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { computeVisualLines } from "./dashboard/components/output-pane.js";

describe("dashboard erase-current-line output", () => {
  it("shows content after terminal output explicitly erased its current line", () => {
    const lines = computeVisualLines([
      { kind: "status", text: "stale result\u001b[2K", ts: 0 }
    ], 40);
    console.log(JSON.stringify(lines.map((line) => line.text)));
    expect(lines.map((line) => line.text)).toEqual(["stale result"]);
  });
});
EOF
trap 'rm -f packages/design-system/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
nl -ba packages/design-system/src/dashboard/ansi.ts | sed -n '54,80p'
nl -ba packages/design-system/src/dashboard/ansi.test.ts | sed -n '129,135p'
nl -ba packages/design-system/src/dashboard/components/output-pane.ts | sed -n '83,102p'
```

## Observed Behavior

Although the stream erases its current line, the dashboard returns the erased status as visible content:

```text
["stale result"]
✓ packages/design-system/src/__probe__.test.ts > dashboard erase-current-line output > shows content after terminal output explicitly erased its current line
```

`parseAnsi()` identifies CSI sequences in `packages/design-system/src/dashboard/ansi.ts:57`, but only applies sequences whose final byte is `m`; `CSI 2 K` is flushed out of the stream without performing line erasure. This is also encoded by the existing unit expectation in `packages/design-system/src/dashboard/ansi.test.ts:130`, which concatenates text surrounding an erase-line sequence. `computeVisualLines()` then renders the retained segments as ordinary visible output in `packages/design-system/src/dashboard/components/output-pane.ts:86`.

## Expected Behavior

The dashboard should model erase-line controls used in terminal output. After `stale result\u001b[2K`, no `stale result` text should remain visible on the current line because `CSI 2 K` erases that line in a terminal.

## Impact

Interactive programs and progress renderers clear temporary messages before drawing updated state or exiting. The dashboard can display cancelled prompts, obsolete status lines, stale spinner text, or cleared warnings that are no longer visible in the originating terminal, misleading users and agents about the current command state.
