# Design system dashboard wraps wide CJK glyphs as single-cell text

## Summary

The design-system dashboard's output-pane line wrapping treats each JavaScript code point as one terminal cell. Wide CJK glyphs that occupy two terminal columns are therefore permitted to fit alongside too much following text. In a dashboard row with three available text cells, `测AB` is kept on one visual line even though a terminal displays `测` across two columns and must wrap `B` onto the following line.

## Reproduction

From the repository root, run a disposable Vitest probe against the exported dashboard output-line computation. A total pane width of six leaves three cells for text after the fixed prefix:

```sh
cat > packages/design-system/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { computeVisualLines } from "./dashboard/components/output-pane.js";

describe("dashboard wide-character wrapping", () => {
  it("keeps a two-column CJK glyph and two following letters on a three-cell text line", () => {
    const lines = computeVisualLines([{ kind: "info", text: "测AB", ts: 0 }], 6);
    console.log(JSON.stringify(lines.map((line) => line.text)));
    expect(lines.map((line) => line.text)).toEqual(["测AB"]);
  });
});
EOF
trap 'rm -f packages/design-system/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
nl -ba packages/design-system/src/dashboard/components/output-pane.ts | sed -n '18,70p;73,159p'
nl -ba packages/design-system/src/dashboard/buffer.ts | sed -n '25,47p'
nl -ba packages/design-system/src/dashboard/snapshot.ts | sed -n '21,53p'
```

## Observed Behavior

The dashboard line computation treats the three code points in `测AB` as fitting within a three-cell terminal text area:

```text
["测AB"]
✓ packages/design-system/src/__probe__.test.ts > dashboard wide-character wrapping > keeps a two-column CJK glyph and two following letters on a three-cell text line
```

`computeVisualLines()` derives a text width from the pane and wraps output in `packages/design-system/src/dashboard/components/output-pane.ts:73` through `packages/design-system/src/dashboard/components/output-pane.ts:159`. Its styled-output helper defines cell count as `Array.from(text).length` at lines 157 through 159, and the unstyled wrapping surface likewise receives the same terminal-width budget without wide-glyph compensation. Rendering then writes one `ScreenBuffer` cell per iterated character in `packages/design-system/src/dashboard/buffer.ts:25` through `packages/design-system/src/dashboard/buffer.ts:47`. `renderDashboardSnapshot()` exposes this path in terminal dashboard output at `packages/design-system/src/dashboard/snapshot.ts:21` through `packages/design-system/src/dashboard/snapshot.ts:53`.

## Expected Behavior

Dashboard wrapping and cell placement should use terminal display width rather than JavaScript code-point count. For three available terminal cells, `测A` should fill the first visual line and `B` should be wrapped onto the next line, matching how the live terminal occupies columns.

## Impact

Dashboard snapshots and interactive output panes containing CJK characters, emoji, or other wide glyphs become misaligned and can overflow dividers or neighboring content. Agents and users reading status dashboards may misinterpret columns, wrapped messages, and layout boundaries whenever international or symbol-rich text is displayed.
