# Terminal pilot screen exposes ANSI concealed text

## Summary

`terminal-pilot`'s screen emulator ignores ANSI conceal styling (`\u001b[8m`). A terminal application that marks sensitive input or content as hidden still exposes that text through `read-screen`/screen snapshot output as ordinary visible characters.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-pilot/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { TerminalBuffer } from "./terminal-buffer.js";

describe("terminal screen conceal", () => {
  it("renders SGR-concealed content visibly in its screen snapshot", () => {
    const terminal = new TerminalBuffer(20, 1);
    terminal.write("\u001b[8msecret\u001b[28m");
    const rawLine = terminal.renderLine(0);
    console.log(JSON.stringify({ rawLine }));
    expect(rawLine).toBe("secret");
  });
});
PROBE
npm exec -- vitest run packages/terminal-pilot/src/__probe__.test.ts --reporter verbose
rm packages/terminal-pilot/src/__probe__.test.ts
```

Output:

```text
{"rawLine":"secret"}
✓ packages/terminal-pilot/src/__probe__.test.ts > terminal screen conceal > renders SGR-concealed content visibly in its screen snapshot
```

## Observed Behavior

`TerminalBuffer` supports several SGR state fields and serializes supported styles back into raw screen lines in `packages/terminal-pilot/src/terminal-buffer.ts`. Its `_applySgr()` switch handles inverse, color, decorations, and reset codes, but does not handle conceal SGR `8` or reveal SGR `28`. Therefore concealed input is stored without a hiding style and `renderLine()` returns the clear text `secret`, which is surfaced by screen snapshot APIs.

## Expected Behavior

Terminal screen capture should preserve conceal state while SGR `8` is active, either by suppressing concealed cell text from readable screen output or by representing it as hidden in any raw/styled surface. Sensitive content intentionally hidden by a terminal UI must not be exposed as clear visible snapshot text.

## Impact

Agents and automation using terminal-pilot to inspect interactive screens can retrieve password input, masked tokens, recovery codes, or other concealed content from applications that correctly hide it in the live terminal. This creates a data-disclosure risk in screen reads independent of generated PNG screenshots.
