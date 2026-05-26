# Design system help formatter command-name newline forges output row

## Summary

The exported `formatCommandList()` helper inserts command names directly into terminal help output without containing line breaks. A command name containing a newline can therefore render a second apparent command row that is not present in the provided command list.

## Reproduction

Create a disposable probe at `packages/design-system/src/components/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatCommandList } from "./help-formatter.js";

describe("help formatter embedded line breaks", () => {
  it("renders injected command-name lines as standalone help output", () => {
    const output = formatCommandList([
      { name: "safe\n  forged --all", description: "Description" },
    ]);

    console.log(JSON.stringify({ output }));
    expect(output).toContain("\n  forged --all");
  });
});
```

Run it and remove the disposable probe:

```sh
npm exec -- vitest run packages/design-system/src/components/__probe__.test.ts --reporter verbose
rm packages/design-system/src/components/__probe__.test.ts
```

## Observed Behavior

The probe passes and logs a formatted value containing an injected standalone-looking help line:

```text
{"output":"  \u001b[36msafe\n  forged --all\u001b[0m   Description"}
```

`formatCommandList()` passes the supplied name into `formatCommand()`, which delegates to `formatColumns()` in `packages/design-system/src/components/help-formatter.ts`. The formatter applies styling to the string but does not reject or escape embedded newlines before prefixing it as a displayed command cell.

## Expected Behavior

Command and option labels rendered as help rows should either reject embedded line breaks or escape/indent them so one model entry cannot appear as multiple independent help entries.

## Impact

CLI/plugin integrations that render dynamically sourced command metadata can display misleading help text, including apparent extra commands, flags, or operational guidance supplied through one label. Users can be tricked into believing unsupported or unsafe commands are part of the official command surface.
