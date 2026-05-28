---
name: "Terminal PNG empty SGR parameter fails to reset active style"
---

# Terminal PNG empty SGR parameter fails to reset active style

## Summary

`@poe-code/terminal-png` fails to apply the ANSI reset represented by an omitted SGR parameter such as `CSI ; m`. After colored terminal output emits `\u001b[;m`, subsequent ordinary text remains rendered using the earlier style instead of returning to the default foreground color.

## Reproduction

Create a disposable Vitest probe at `packages/terminal-png/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";

import { parseAnsi } from "./ansi-parser.js";
import { renderSvg } from "./svg-renderer.js";

describe("empty SGR parameter reset", () => {
  it("renders text after CSI ; m with the prior red style", () => {
    const runs = parseAnsi("\u001b[31mred\u001b[;m plain");
    const svg = renderSvg(runs, { window: false });

    expect(runs).toEqual([
      {
        text: "red plain",
        fg: { type: "ansi4", index: 1 },
        bg: null,
        bold: false,
        italic: false,
        underline: false,
        strikethrough: false,
        dim: false,
      },
    ]);
    expect(svg).toContain('fill="#D74E6F">red plain</tspan>');
  });
});
```

Run the focused probe, then remove it:

```sh
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm packages/terminal-png/src/__probe__.test.ts
```

Observed test output:

```text
✓ packages/terminal-png/src/__probe__.test.ts > empty SGR parameter reset > renders text after CSI ; m with the prior red style
```

## Observed Behavior

`parseAnsi("\u001b[31mred\u001b[;m plain")` produces one red styled run containing `"red plain"`, and the SVG output emits a red `<tspan>` for both words. In `packages/terminal-png/src/ansi-parser.ts`, `applySgr()` treats an empty field as invalid because `toInteger("")` returns `null`; it then returns the unchanged active style for the complete SGR sequence.

## Expected Behavior

An omitted SGR parameter represents reset parameter `0`, so `CSI ; m` should reset the active style. The text after the sequence should render in the default terminal foreground rather than being merged into the preceding red run.

## Impact

Generated screenshots can misrepresent terminal output whenever applications use empty SGR parameters while resetting style. Status messages, prompts, and adjacent output may falsely inherit warning or error coloration, making visual snapshots unreliable for review and agent-driven UI validation.
