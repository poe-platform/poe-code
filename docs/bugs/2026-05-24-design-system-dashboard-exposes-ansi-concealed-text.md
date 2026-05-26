# Design system dashboard exposes ANSI concealed text

## Summary

The design-system dashboard parses ANSI-formatted output for display, but it does not implement conceal SGR `8` or reveal SGR `28`. Text marked concealed by a terminal application is merged into ordinary visible dashboard segments. For example, `token=\u001b[8msecret\u001b[28m` is exposed as visible `token=secret` in dashboard output.

## Reproduction

From the repository root, run a disposable Vitest probe against the dashboard ANSI parser with a concealed secret value:

```sh
cat > packages/design-system/src/__probe__.test.ts <<'EOF'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./dashboard/ansi.js";

describe("dashboard ANSI conceal", () => {
  it("returns concealed terminal text as ordinary visible output", () => {
    const lines = parseAnsi("token=\u001b[8msecret\u001b[28m");
    console.log(JSON.stringify(lines));
    expect(lines).toEqual([{ segments: [{ text: "token=secret", style: {} }] }]);
  });
});
EOF
trap 'rm -f packages/design-system/src/__probe__.test.ts' EXIT
./node_modules/.bin/vitest run packages/design-system/src/__probe__.test.ts --reporter verbose
nl -ba packages/design-system/src/dashboard/ansi.ts | sed -n '26,115p;178,289p'
nl -ba packages/design-system/src/dashboard/components/output-pane.ts | sed -n '83,102p'
```

## Observed Behavior

The dashboard parser returns the concealed value as ordinary visible text with no hiding style or redaction:

```text
[{"segments":[{"text":"token=secret","style":{}}]}]
✓ packages/design-system/src/__probe__.test.ts > dashboard ANSI conceal > returns concealed terminal text as ordinary visible output
```

`parseAnsi()` processes SGR input in `packages/design-system/src/dashboard/ansi.ts:26` through `packages/design-system/src/dashboard/ansi.ts:115`, but its style switch at `packages/design-system/src/dashboard/ansi.ts:178` through `packages/design-system/src/dashboard/ansi.ts:289` handles bold, dim, and colors only; no conceal state is retained for codes `8` or `28`. The dashboard output pane feeds ANSI-bearing application output through this parser in `packages/design-system/src/dashboard/components/output-pane.ts:83` through `packages/design-system/src/dashboard/components/output-pane.ts:102`, so the clear text is rendered in dashboard views.

## Expected Behavior

Dashboard rendering should preserve terminal conceal semantics while SGR `8` is active, either by suppressing concealed text or representing it with a hidden style that is not visibly rendered. SGR `28` or reset may restore display only after the concealed content has remained protected.

## Impact

Interactive processes can use terminal conceal for passwords, API keys, recovery codes, or masked prompts. Feeding their output into design-system dashboards can reveal those secrets visibly in status displays, snapshots, or agent-observed panes, creating a sensitive-data exposure path distinct from terminal-pilot screen reads and terminal-png images.
