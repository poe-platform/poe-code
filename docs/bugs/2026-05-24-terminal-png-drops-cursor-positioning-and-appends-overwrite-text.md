# Terminal PNG drops cursor positioning and appends overwrite text

## Summary

`terminal-png` consumes standard CSI cursor-positioning commands while rendering terminal output, but it does not apply their display semantics. Text written after cursor-home or cursor-position controls is appended to earlier content rather than overwriting the cells that a live terminal would replace.

## Reproduction

Run a transient Vitest probe from the repository root:

```sh
cat > packages/terminal-png/src/__probe__.test.ts <<'PROBE'
import { describe, expect, it } from "vitest";
import { parseAnsi } from "./ansi-parser.js";

describe("terminal cursor repositioning", () => {
  it("drops cursor-home control but leaves overwritten text concatenated", () => {
    const runs = parseAnsi("ready\u001b[1GFAIL");
    console.log(JSON.stringify(runs));
    expect(runs.map((run) => run.text).join("")).toBe("readyFAIL");
  });
});
PROBE
npx vitest run packages/terminal-png/src/__probe__.test.ts --reporter=verbose
rm -f packages/terminal-png/src/__probe__.test.ts
```

Output:

```text
[{"text":"readyFAIL","fg":null,"bg":null,"bold":false,"italic":false,"underline":false,"strikethrough":false,"dim":false}]
✓ packages/terminal-png/src/__probe__.test.ts > terminal cursor repositioning > drops cursor-home control but leaves overwritten text concatenated
```

## Observed Behavior

The input prints `ready`, moves the cursor to column one with `CSI 1 G`, and then prints `FAIL`. `parseAnsi()` returns one text run containing `readyFAIL`, so the generated image renders both the stale and replacement text in sequence. `packages/terminal-png/src/ansi-parser.ts:92` through `packages/terminal-png/src/ansi-parser.ts:111` parse any CSI command, but the main loop at `packages/terminal-png/src/ansi-parser.ts:289` through `packages/terminal-png/src/ansi-parser.ts:320` changes state only for final byte `m`; all other CSI commands, including horizontal absolute position `G`, are discarded without updating display layout.

## Expected Behavior

`CSI 1 G` should move the rendering cursor to the beginning of the current line before writing the following characters. The visible rendered line for `ready\u001b[1GFAIL` should represent replacement output such as `FAILy`, not the concatenated transcript text `readyFAIL`.

## Impact

Interactive CLIs frequently redraw status labels, prompts, input fields, and progress indicators using explicit cursor positioning rather than carriage returns alone. Screenshots rendered by terminal-png can display stale and replacement text together, producing misleading visual evidence and causing agents or visual checks to interpret an interface state that was never visible on the terminal.
