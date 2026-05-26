# Toolcraft CLI kebab case parameter collision prevents command startup

## Summary

The public `toolcraft/cli` `runCLI()` adapter cannot expose a valid command schema that declares distinct fields whose names normalize to the same kebab-case option. A command containing `fooBar` and `foo_bar` crashes during CLI construction with a conflicting `--foo-bar` option error before any invocation can reach its handler.

## Reproduction

Create the disposable probe `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { S } from "toolcraft-schema";

import { runCLI } from "./cli.js";
import { defineCommand, defineGroup } from "./index.js";

describe("CLI parameter casing collision", () => {
  it("fails before dispatch when two declared fields normalize to one option", async () => {
    const handler = async () => "unreachable";
    const root = defineGroup({
      name: "probe",
      children: [
        defineCommand({
          name: "submit",
          params: S.Object({
            fooBar: S.String(),
            foo_bar: S.String()
          }),
          handler
        })
      ]
    });
    process.argv = ["node", "probe", "submit", "--foo-bar", "value", "--yes"];

    let caught: unknown;
    try {
      await runCLI(root);
    } catch (error) {
      caught = error;
    }

    console.log(String(caught));
    expect(String(caught)).toMatch(/foo-bar|duplicate|conflict/i);
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and prints:

```text
Error: Cannot add option '--foo-bar <value>' to command 'submit' due to conflicting flag '--foo-bar'
-  already used by option '--foo-bar <value>'
✓ packages/toolcraft/src/__probe__.test.ts > CLI parameter casing collision > fails before dispatch when two declared fields normalize to one option
```

The default CLI casing formats both field segments as `foo-bar` through `formatSegment()` and `toOptionFlag()` at `packages/toolcraft/src/cli.ts:307` through `packages/toolcraft/src/cli.ts:314`. `collectFields()` retains both valid source fields as separate entries at `packages/toolcraft/src/cli.ts:379` through `packages/toolcraft/src/cli.ts:415` and `packages/toolcraft/src/cli.ts:580` through `packages/toolcraft/src/cli.ts:598`, but `createNodeCommand()` subsequently adds both generated options to the same Commander command at `packages/toolcraft/src/cli.ts:1810` through `packages/toolcraft/src/cli.ts:1841`, where the second `--foo-bar` registration throws.

## Expected Behavior

CLI construction should reject schemas whose configured casing would create duplicate option names with a Toolcraft-owned validation error, or use an unambiguous option encoding that preserves both declared parameters. A valid schema should not fail unexpectedly inside Commander before handler execution.

## Impact

CLI packages exposing existing SDK payloads cannot support legitimate external fields that differ only by camel-case versus underscore formatting. Adding such a field can make an entire command unusable at startup, with a low-level library error rather than a clear schema compatibility diagnostic or an accessible command surface.
