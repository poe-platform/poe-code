# Terminal PNG renders C1 CSI controls as visible text

## Summary

`terminal-png` recognizes ANSI Control Sequence Introducer commands only in their two-byte `ESC [` representation. The equivalent single-byte C1 CSI control (`0x9b`) is left inside visible text runs, so valid color/control sequences can appear as garbage characters and parameter text in rendered screenshots instead of affecting presentation.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-png/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";

describe("terminal-png C1 CSI", () => {
  it("renders a single-byte CSI color control as visible text instead of styling", () => {
    const runs = parseAnsi("\u009b31mRED\u009b0m");
    console.log(JSON.stringify(runs));
    expect(runs[0]?.text).toContain("\u009b31m");
    expect(runs[0]?.fg).toBeNull();
  });
});
PROBE
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm packages/terminal-png/src/__probe__.test.ts
```

Output:

```text
[{"text":"31mRED0m","fg":null,"bg":null,"bold":false,"italic":false,"underline":false,"strikethrough":false,"dim":false}]
✓ packages/terminal-png/src/__probe__.test.ts > terminal-png C1 CSI > renders a single-byte CSI color control as visible text instead of styling
```

## Observed Behavior

An input string that sets red foreground with C1 CSI, renders `RED`, and resets style is returned as one unstyled text run containing both control sequences. `packages/terminal-png/src/ansi-parser.ts` scans only for `ESC` followed by `[` before invoking CSI parsing; it has no branch for the single-byte `0x9b` CSI form, leaving those bytes and their SGR parameters in visible output.

## Expected Behavior

The ANSI parser should recognize C1 CSI as equivalent to `ESC [` and apply/remove color state without including control payload in displayed text. This stream should render only `RED` with a red foreground followed by reset styling.

## Impact

Terminal output captured from transports or applications that emit 8-bit C1 controls can produce screenshots containing visible formatting garbage while losing colors and other display semantics. This corrupts generated visual artifacts and can expose otherwise non-visible control payloads to agents or users.
