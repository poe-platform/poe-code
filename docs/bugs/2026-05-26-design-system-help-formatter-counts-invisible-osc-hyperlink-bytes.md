# Design system help formatter counts invisible OSC hyperlink bytes

## Summary

The exported `formatColumns()` help formatter strips only CSI sequences ending in `m` when measuring label widths. Terminal OSC hyperlink sequences remain in its calculated width even though terminals display only the hyperlink label, causing large invisible padding gaps and broken help alignment.

## Reproduction

Create a disposable probe at `packages/design-system/src/components/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatColumns } from "./help-formatter.js";

describe("help formatter OSC hyperlink width", () => {
  it("counts invisible hyperlink control bytes as visible label width", () => {
    const linked = "\u001b]8;;https://example.test\u0007go\u001b]8;;\u0007";
    const output = formatColumns({
      rows: [
        { left: linked, right: "linked" },
        { left: "go", right: "plain" },
      ],
      indent: 0,
      gap: 1,
      minLeftWidth: 1,
      maxLeftWidth: 80,
      totalWidth: 120,
    });
    const lines = output.split("\n");

    console.log(JSON.stringify({ output, plainSpacesBeforeDescription: lines[1].indexOf("plain") - 2 }));
    expect(lines[1].indexOf("plain") - 2).toBeGreaterThan(10);
  });
});
```

Run the probe and remove it afterward:

```sh
npm exec -- vitest run packages/design-system/src/components/__probe__.test.ts --reporter verbose
rm packages/design-system/src/components/__probe__.test.ts
```

## Observed Behavior

The probe passes and shows that the plain two-letter label is padded with thirty-three spaces because the other visible two-letter label contains invisible OSC bytes:

```text
{"output":"\u001b]8;;https://example.test\u0007go\u001b]8;;\u0007 linked\ngo                                 plain","plainSpacesBeforeDescription":33}
```

`stripAnsi()` in `packages/design-system/src/components/help-formatter.ts` recognizes only escape sequences beginning with `ESC [` and consumes through an `m` terminator. OSC 8 hyperlinks begin with `ESC ]` and are therefore counted by `visibleWidth()` as if their hidden target URI and delimiters occupied terminal cells.

## Expected Behavior

Column measurement should ignore all terminal control sequences that do not occupy visible cells, including OSC hyperlinks, so a styled or linked label aligns exactly like its visible text.

## Impact

CLI help content containing terminal hyperlinks becomes severely misaligned or wraps prematurely, with padding proportional to hidden URLs rather than displayed labels. This can make dynamic or linked help displays unreadable even though the terminal visually renders short, ordinary command names.
