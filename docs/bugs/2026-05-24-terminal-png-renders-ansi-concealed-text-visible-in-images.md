---
name: "Terminal PNG renders ANSI concealed text visible in images"
---

# Terminal PNG renders ANSI concealed text visible in images

## Summary

`terminal-png` ignores the standard ANSI conceal SGR sequence (`\u001b[8m`). Text a terminal application intentionally renders as hidden is included visibly in generated SVG and PNG screenshots, potentially disclosing content that the terminal UI suppresses.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-png/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";

describe("ANSI conceal styling", () => {
  it("renders text that the terminal marked hidden with SGR 8", () => {
    const runs = parseAnsi("visible \u001b[8msecret\u001b[28m shown");
    const svg = renderSvg(runs, { window: false });
    console.log(JSON.stringify({ runs, rendersSecret: svg.includes("secret") }));
    expect(svg).toContain("secret");
  });
});
PROBE
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm packages/terminal-png/src/__probe__.test.ts
```

Output:

```text
{"runs":[{"text":"visible secret shown","fg":null,"bg":null,"bold":false,"italic":false,"underline":false,"strikethrough":false,"dim":false}],"rendersSecret":true}
✓ packages/terminal-png/src/__probe__.test.ts > ANSI conceal styling > renders text that the terminal marked hidden with SGR 8
```

## Observed Behavior

The parser's `StyledRun` representation in `packages/terminal-png/src/ansi-parser.ts` has no hidden/conceal state, and its SGR handling does not interpret SGR `8` or reset SGR `28`. As a result, concealed input is merged into an ordinary visible text run. `renderSvg()` then emits the `secret` text into its `<tspan>` output with no opacity or visibility suppression, even though terminal programs use conceal mode specifically to prevent that content from appearing on screen.

## Expected Behavior

Terminal screenshot rendering should preserve ANSI conceal behavior while SGR `8` is active and restore visibility only after SGR `28` or a full reset. Content emitted as concealed should not become visibly readable in generated SVG or PNG output.

## Impact

Terminal applications may use conceal mode for password input, masked values, recovery codes, or temporarily hidden interactive fields. Screenshot generation can unexpectedly expose that content in visual artifacts used for debugging, documentation, or agent inspection, converting intentionally hidden terminal output into readable image data.
