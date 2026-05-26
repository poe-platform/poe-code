# Design system dashboard concatenates carriage-return progress updates

## Summary

The design-system dashboard discards carriage-return control characters while preserving both the old and replacement text surrounding them. Terminal output that refreshes a single line with `\r`, such as progress percentages and spinners, is displayed as concatenated historical states instead of the final visible line.

## Reproduction

From the repository root, run a disposable Vitest probe through dashboard output rendering:

```sh
cat > packages/design-system/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { computeVisualLines } from "./dashboard/components/output-pane.js";

describe("dashboard carriage-return progress updates", () => {
  it("concatenates rewritten progress output instead of showing the visible final line", () => {
    const lines = computeVisualLines([
      { kind: "info", text: "\u001b[32mloading 0%\rloading 100%\u001b[0m", ts: 0 }
    ], 40);
    console.log(JSON.stringify(lines.map((line) => line.text)));
    expect(lines.map((line) => line.text)).toEqual(["loading 0%loading 100%"]);
  });
});
EOF
trap 'rm -f packages/design-system/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
nl -ba packages/design-system/src/dashboard/ansi.ts | sed -n '80,110p'
nl -ba packages/design-system/src/dashboard/components/output-pane.ts | sed -n '73,118p'
```

## Observed Behavior

The dashboard presents the initial progress value and its in-place replacement as one continuous string:

```text
["loading 0%loading 100%"]
✓ packages/design-system/src/__probe__.test.ts > dashboard carriage-return progress updates > concatenates rewritten progress output instead of showing the visible final line
```

`parseAnsi()` drops `\r` without moving a logical cursor or overwriting earlier cells in `packages/design-system/src/dashboard/ansi.ts:93`. Styled output is subsequently wrapped and rendered from the resulting concatenated segments by `packages/design-system/src/dashboard/components/output-pane.ts:73` and `packages/design-system/src/dashboard/components/output-pane.ts:119`.

## Expected Behavior

Carriage return should move the output cursor to the beginning of the current visual line so subsequent content replaces earlier visible cells. For `loading 0%\rloading 100%`, the dashboard should display `loading 100%` as the visible current state rather than retaining both progress updates.

## Impact

Command-line tools commonly update progress bars, download percentages, timers, test status, and spinner messages in place using carriage returns. Displaying every refresh concatenated together produces misleading status output, quickly overruns dashboard layout, and can make active operations look stuck or corrupted.
