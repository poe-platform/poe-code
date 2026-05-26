# Plan browser editor flags are treated as executable name

## Summary

The exported `@poe-code/plan-browser` `editFile()` helper resolves `$EDITOR` or `$VISUAL` as a single string and passes that whole string as the executable to `spawnSync()`. Common editor settings that include required flags, such as `EDITOR="code --wait"`, therefore attempt to launch a binary literally named `code --wait` instead of launching `code` with `--wait` and the selected plan path.

## Reproduction

Create a disposable Vitest probe at `packages/plan-browser/src/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { editFile, resolveEditor } from "./actions.js";

describe("plan-browser EDITOR arguments", () => {
  it("treats a standard editor command with flags as one executable name", () => {
    const spawnSync = vi.fn();
    const absolutePath = "/repo/docs/plans/plan.md";

    editFile(absolutePath, {
      env: { EDITOR: "code --wait" },
      spawnSync: spawnSync as never,
    });

    console.log(JSON.stringify({
      resolved: resolveEditor({ EDITOR: "code --wait" }),
      call: spawnSync.mock.calls[0],
    }));
    expect(spawnSync).toHaveBeenCalledWith("code --wait", [absolutePath], {
      stdio: "inherit",
    });
  });
});
```

Run the probe and then remove it:

```sh
npm exec -- vitest run packages/plan-browser/src/__probe__.test.ts --reporter verbose
rm -f packages/plan-browser/src/__probe__.test.ts
```

The probe prints:

```text
{"resolved":"code --wait","call":["code --wait",["/repo/docs/plans/plan.md"],{"stdio":"inherit"}]}
✓ packages/plan-browser/src/__probe__.test.ts > plan-browser EDITOR arguments > treats a standard editor command with flags as one executable name
```

## Observed Behavior

`packages/plan-browser/src/index.ts` exports `editFile()` and `resolveEditor()`, while the package advertises editing selected plans through `$EDITOR`. `resolveEditor()` in `packages/plan-browser/src/actions.ts` returns the trimmed environment variable verbatim. `editFile()` then invokes `spawnSync(editor, [absolutePath], { stdio: "inherit" })`. For `EDITOR="code --wait"`, the captured invocation is `spawnSync("code --wait", [path], ...)`, which ordinary process spawning treats as a request for an executable whose filename contains the space and flag text.

## Expected Behavior

Editor configuration should support conventional argument-bearing commands, invoking `code` with arguments such as `--wait` before the selected file path, or the API should explicitly reject such settings with a clear diagnostic. A standard `$EDITOR` value must not silently become an invalid executable pathname.

## Impact

Users whose editor configuration requires flags cannot edit plans through the plan browser or any consumer of `editFile()`. This especially affects GUI editors that need a wait flag so the surrounding workflow can tell when editing is finished, and it compounds existing success-reporting behavior by making routine editor configuration fail at launch time.
