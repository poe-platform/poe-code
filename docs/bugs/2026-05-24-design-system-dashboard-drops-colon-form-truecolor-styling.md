# Design system dashboard drops colon-form truecolor styling

## Summary

The design-system dashboard ANSI parser does not support standard colon-separated SGR truecolor sequences such as `CSI 38:2::255:0:0 m`. Dashboard output containing this valid terminal color encoding is parsed as unstyled text, so status panes and snapshots lose 24-bit foreground styling independently of the separate terminal-pilot and terminal-png implementations.

## Reproduction

From the repository root, run a disposable Vitest probe against the dashboard ANSI parser with a colon-form red foreground sequence:

```sh
cat > packages/design-system/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./dashboard/ansi.js";

describe("dashboard colon-form truecolor", () => {
  it("drops standard colon-separated foreground color styling", () => {
    const lines = parseAnsi("\u001b[38:2::255:0:0mRED");
    console.log(JSON.stringify(lines));
    expect(lines).toEqual([{ segments: [{ text: "RED", style: {} }] }]);
  });
});
EOF
trap 'rm -f packages/design-system/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
nl -ba packages/design-system/src/dashboard/ansi.ts | sed -n '26,95p;102,123p;178,289p'
nl -ba packages/design-system/src/dashboard/components/output-pane.ts | sed -n '83,102p'
```

## Observed Behavior

The dashboard parses the visible text but drops the requested red foreground style:

```text
[{"segments":[{"text":"RED","style":{}}]}]
✓ packages/design-system/src/__probe__.test.ts > dashboard colon-form truecolor > drops standard colon-separated foreground color styling
```

`parseAnsi()` extracts the raw CSI parameter string and calls `parseParams()` in `packages/design-system/src/dashboard/ansi.ts:26` through `packages/design-system/src/dashboard/ansi.ts:123`. That parser separates parameters only on semicolons and coerces the colon-bearing field to a non-truecolor numeric interpretation. `applySgr()` supports foreground truecolor only as semicolon-separated parameters at `packages/design-system/src/dashboard/ansi.ts:178` through `packages/design-system/src/dashboard/ansi.ts:289`. The output pane directly uses this parser for ANSI-bearing dashboard messages in `packages/design-system/src/dashboard/components/output-pane.ts:83` through `packages/design-system/src/dashboard/components/output-pane.ts:102`.

## Expected Behavior

Dashboard ANSI parsing should preserve colon-form 24-bit SGR styling equivalently to semicolon-form truecolor. Text emitted as red through `CSI 38:2::255:0:0 m` should remain red in dashboard rendering and snapshots.

## Impact

Modern terminal output embedded in design-system dashboards can silently lose syntax highlights, warning colors, status accents, and selection styling when emitters use colon-form truecolor. Dashboard visual evidence can therefore misrepresent active alerts or application state even when the original terminal stream is correctly styled.
