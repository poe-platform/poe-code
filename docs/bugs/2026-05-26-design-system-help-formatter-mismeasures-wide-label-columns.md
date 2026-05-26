# Design system help formatter mismeasures wide label columns

## Summary

The exported `formatColumns()` help formatter calculates visible label widths using JavaScript string length after stripping ANSI codes. Double-cell terminal glyphs such as CJK characters are counted as a single column, so option or command descriptions render one terminal cell out of alignment with ordinary ASCII labels.

## Reproduction

Create a disposable probe at `packages/design-system/src/components/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatColumns } from "./help-formatter.js";

function terminalCells(prefix: string): number {
  let width = 0;
  for (const char of prefix) {
    width += char === "界" ? 2 : 1;
  }
  return width;
}

describe("help formatter terminal width", () => {
  it("misaligns a wide command label against ASCII labels", () => {
    const output = formatColumns({
      rows: [
        { left: "界", right: "wide" },
        { left: "aa", right: "ascii" },
      ],
      indent: 0,
      gap: 1,
      minLeftWidth: 3,
      maxLeftWidth: 3,
      totalWidth: 40,
    });
    const lines = output.split("\n");
    const wideColumn = terminalCells(lines[0].slice(0, lines[0].indexOf("wide")));
    const asciiColumn = terminalCells(lines[1].slice(0, lines[1].indexOf("ascii")));

    console.log(JSON.stringify({ output, wideColumn, asciiColumn }));
    expect(wideColumn).toBe(4);
    expect(asciiColumn).toBe(3);
  });
});
```

Run the probe and remove it afterwards:

```sh
npm exec -- vitest run packages/design-system/src/components/__probe__.test.ts --reporter verbose
rm packages/design-system/src/components/__probe__.test.ts
```

## Observed Behavior

The probe passes and demonstrates that the two descriptions begin in different terminal columns:

```text
{"output":"界  wide\naa ascii","wideColumn":4,"asciiColumn":3}
```

`visibleWidth()` in `packages/design-system/src/components/help-formatter.ts` returns `stripAnsi(value).length`, and `formatColumns()` uses that value to choose column width and padding. The label `界` occupies two terminal cells but contributes length `1`, causing one extra inserted padding cell before its description.

## Expected Behavior

Terminal-oriented help formatting should measure displayed cell width, including double-cell Unicode glyphs and grapheme clusters, so description columns remain aligned for localized or symbol-rich labels.

## Impact

CLI help output that contains international command names, localized option labels, or other wide symbols renders with uneven description columns and can wrap incorrectly at configured widths. This is independent of dashboard rendering: it affects static command/help formatting exposed directly through the public design-system API.
