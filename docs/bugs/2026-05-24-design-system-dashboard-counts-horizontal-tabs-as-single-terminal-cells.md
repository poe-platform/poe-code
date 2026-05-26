# Design system dashboard counts horizontal tabs as single terminal cells

## Summary

The design-system dashboard preserves horizontal tab characters in output text but computes line capacity using one JavaScript character per terminal cell. Consequently, a string such as `A\tB` is treated as fitting inside a three-cell output area, even though a terminal tab advances `B` to the next tab stop and requires substantially more display width. Dashboard rendering of tabular command output is therefore compressed and misaligned.

## Reproduction

From the repository root, run a disposable Vitest probe against dashboard output wrapping. A total pane width of six leaves three text cells after the dashboard prefix:

```sh
cat > packages/design-system/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { computeVisualLines } from "./dashboard/components/output-pane.js";

describe("dashboard horizontal tab layout", () => {
  it("counts a tab as one cell instead of advancing to a terminal tab stop", () => {
    const lines = computeVisualLines([{ kind: "info", text: "A\tB", ts: 0 }], 6);
    console.log(JSON.stringify(lines.map((line) => line.text)));
    expect(lines.map((line) => line.text)).toEqual(["A\tB"]);
  });
});
EOF
trap 'rm -f packages/design-system/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
nl -ba packages/design-system/src/dashboard/ansi.ts | sed -n '93,110p'
nl -ba packages/design-system/src/dashboard/components/output-pane.ts | sed -n '18,70p;73,159p'
nl -ba packages/design-system/src/dashboard/buffer.ts | sed -n '25,47p'
```

## Observed Behavior

The dashboard wrapper retains all three characters on one three-cell visual line, including the raw tab:

```text
["A\tB"]
✓ packages/design-system/src/__probe__.test.ts > dashboard horizontal tab layout > counts a tab as one cell instead of advancing to a terminal tab stop
```

The ANSI parser explicitly retains tab characters as output content in `packages/design-system/src/dashboard/ansi.ts:93` through `packages/design-system/src/dashboard/ansi.ts:110`. Output-pane layout applies a fixed text-width budget in `packages/design-system/src/dashboard/components/output-pane.ts:18` through `packages/design-system/src/dashboard/components/output-pane.ts:159`, where styled segment width is counted by `Array.from(text).length`, and screen placement writes one cell per character in `packages/design-system/src/dashboard/buffer.ts:25` through `packages/design-system/src/dashboard/buffer.ts:47`. No tab-stop expansion occurs before layout or rendering.

## Expected Behavior

Dashboard layout should expand tabs according to terminal tab-stop semantics when measuring and positioning output. With conventional eight-column tab stops, `A\tB` cannot fit in three terminal cells and should wrap or be clipped according to its actual visible width rather than its raw character count.

## Impact

Commands frequently emit tab-delimited tables, help output, aligned logs, and diagnostic summaries. When displayed in design-system dashboards, columns can collapse together or overrun pane boundaries, making monitoring output difficult to read and leading agents or users to misinterpret aligned values and labels.
