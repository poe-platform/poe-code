# Terminal PNG renders OSC hyperlink targets as visible text

## Summary

`terminal-png` only recognizes CSI styling sequences and does not consume OSC hyperlink control sequences. A terminal hyperlink whose visible label is harmless can therefore be rendered into screenshots with its hidden target URL and escape payload visibly exposed.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-png/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";

describe("OSC hyperlink output", () => {
  it("renders OSC hyperlink payload characters instead of only linked text", () => {
    const input = "\u001b]8;;https://secret.example/token\u0007click\u001b]8;;\u0007";
    const text = parseAnsi(input).map((run) => run.text).join("");
    console.log(JSON.stringify({ text }));
    expect(text).toContain("https://secret.example/token");
  });
});
PROBE
npm exec -- vitest run packages/terminal-png/src/__probe__.test.ts --reporter verbose
rm packages/terminal-png/src/__probe__.test.ts
```

Output:

```text
{"text":"\u001b]8;;https://secret.example/token\u0007click\u001b]8;;\u0007"}
✓ packages/terminal-png/src/__probe__.test.ts > OSC hyperlink output > renders OSC hyperlink payload characters instead of only linked text
```

## Observed Behavior

OSC 8 hyperlinks are emitted by terminal programs as control sequences containing a hidden URL and visible link label. `parseAnsi()` in `packages/terminal-png/src/ansi-parser.ts` handles newlines and `ESC [` CSI sequences only; all other characters, including `ESC ]...BEL` OSC content, stay in ordinary text runs. The reproduced hyperlink target URL is therefore preserved as printable run text and will be written into the SVG/PNG rather than displaying only `click`.

## Expected Behavior

Terminal screenshot rendering should consume supported or ignorable terminal control strings such as OSC hyperlinks without exposing their metadata as visible text. An OSC 8 hyperlink should render its visible label while suppressing the hidden target payload and control delimiters.

## Impact

Generated screenshots can leak URLs containing private paths, tokens, query parameters, or internal resource identifiers that are not visibly displayed by the live terminal. Terminal applications that emit clickable file or service links may unintentionally expose hyperlink metadata in visual artifacts and agent-visible captures.
