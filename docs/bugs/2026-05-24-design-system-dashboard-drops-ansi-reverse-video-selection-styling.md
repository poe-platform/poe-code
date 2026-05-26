# Design system dashboard drops ANSI reverse video selection styling

## Summary

The design-system dashboard ANSI parser does not represent or apply reverse-video SGR `7` and its reset `27`. Terminal applications that indicate focused or selected rows by inverting foreground and background colors appear as ordinary unselected text in dashboard output. A styled stream containing `\u001b[7mSELECTED\u001b[27m` is returned as a plain `SELECTED` segment.

## Reproduction

From the repository root, run a disposable Vitest probe against the dashboard ANSI parser using standard reverse-video styling:

```sh
cat > packages/design-system/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./dashboard/ansi.js";

describe("dashboard ANSI reverse video", () => {
  it("drops reverse-video styling used for selected rows", () => {
    const lines = parseAnsi("\u001b[7mSELECTED\u001b[27m");
    console.log(JSON.stringify(lines));
    expect(lines).toEqual([{ segments: [{ text: "SELECTED", style: {} }] }]);
  });
});
EOF
trap 'rm -f packages/design-system/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
nl -ba packages/design-system/src/dashboard/ansi.ts | sed -n '26,115p;178,289p'
nl -ba packages/design-system/src/dashboard/components/output-pane.ts | sed -n '83,102p'
```

## Observed Behavior

The dashboard parser returns selected text with no foreground/background inversion or other visual distinction:

```text
[{"segments":[{"text":"SELECTED","style":{}}]}]
✓ packages/design-system/src/__probe__.test.ts > dashboard ANSI reverse video > drops reverse-video styling used for selected rows
```

`parseAnsi()` handles SGR state transitions in `packages/design-system/src/dashboard/ansi.ts:26` through `packages/design-system/src/dashboard/ansi.ts:115`, but `applySgr()` at `packages/design-system/src/dashboard/ansi.ts:178` through `packages/design-system/src/dashboard/ansi.ts:289` recognizes bold, dim, foreground, and background color operations only; SGR codes `7` and `27` fall through without changing style. ANSI-bearing dashboard output is rendered through this parser in `packages/design-system/src/dashboard/components/output-pane.ts:83` through `packages/design-system/src/dashboard/components/output-pane.ts:102`.

## Expected Behavior

Dashboard rendering should preserve reverse-video terminal semantics, swapping or otherwise visually inverting foreground and background while SGR `7` is active and restoring normal styling on SGR `27` or reset. A selected terminal row must remain visibly selected in the dashboard.

## Impact

Terminal interfaces frequently communicate cursor position, active menu choices, and focused controls using reverse video rather than text labels. When their output is displayed in design-system dashboards, selected and unselected rows can become indistinguishable, leading users and agents to misread interactive application state or choose the wrong action.
