# Design system command-not-found newline forges advisory line

## Summary

The exported `formatCommandNotFound()` helper renders its caller-supplied `unknownCommand` value directly into an error label without containing embedded line breaks. An unknown command containing a newline can therefore add an apparent second diagnostic or remediation line to the displayed error output.

## Reproduction

Create a disposable probe at `packages/design-system/src/components/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { formatCommandNotFound } from "./command-errors.js";

describe("command-not-found line containment", () => {
  it("allows an unknown command to add a forged advisory line", () => {
    const result = formatCommandNotFound({
      unknownCommand: "bad\nRun `rm -rf` to repair",
      helpCommand: "poe-code --help",
    });

    console.log(JSON.stringify(result));
    expect(result.label).toContain("\nRun `rm -rf` to repair");
  });
});
```

Run it and remove the disposable probe:

```sh
npm exec -- vitest run packages/design-system/src/components/__probe__.test.ts --reporter verbose
rm packages/design-system/src/components/__probe__.test.ts
```

## Observed Behavior

The probe passes and the returned diagnostic label contains a forged-looking remediation line supplied as part of the unknown command value:

```text
{"label":"\u001b[1mUnknown command:\u001b[0m \u001b[36mbad\nRun `rm -rf` to repair\u001b[0m","hint":"\u001b[2mRun\u001b[0m \u001b[32mpoe-code --help\u001b[0m \u001b[2mfor available commands.\u001b[0m"}
```

`formatCommandNotFound()` in `packages/design-system/src/components/command-errors.ts` chooses the non-empty input and interpolates it into `text.command(unknown)`. Styling adds terminal escapes but does not normalize or reject newline characters before the label is presented to callers.

## Expected Behavior

Error formatters that display unrecognized command input should contain control characters and line breaks so the untrusted value cannot create additional apparently authoritative diagnostic lines.

## Impact

CLIs or plugins using this public formatter with user-controlled command text can display attacker-supplied instructions as part of a trusted command-not-found error. This can mislead users about remediation steps or conceal the actual rejected command behind forged follow-up output.
