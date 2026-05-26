# Agent Hook Config concurrent Codex hook publication shares one temporary file

## Summary

`writeCodexHooks()` publishes a transformed Codex hooks file through the fixed temporary pathname `${targetPath}.tmp`. Reentrant or concurrent writes to the same hooks file therefore stage through one shared file. A later publication can rename that staging file before the earlier publication reaches its rename, causing the earlier valid write to throw after another write has unexpectedly replaced its staged content.

## Reproduction

1. Add this disposable probe as `packages/agent-hook-config/src/__probe__.test.ts`:

```ts
import * as fs from "node:fs";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { writeCodexHooks } from "./write-hooks.js";

vi.mock("node:fs", async () => {
  const { fs: memoryFs } = await import("memfs");
  return { ...memoryFs, default: memoryFs };
});

describe("Codex hook concurrent publication probe", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vol.reset();
  });

  it("fails one write when reentrant publication shares the target temporary file", () => {
    const targetPath = "/repo/.codex/hooks.json";
    vol.fromJSON({ [targetPath]: '{"hooks":{}}\n' });
    const rename = fs.renameSync.bind(fs);
    let renameCount = 0;

    vi.spyOn(fs, "renameSync").mockImplementation((source, destination) => {
      renameCount += 1;
      if (renameCount === 1) {
        writeCodexHooks(
          targetPath,
          [
            {
              event: "Stop",
              generatedId: "second",
              handler: {
                type: "command",
                command: "second",
                statusMessage: "[generated:second] second"
              }
            }
          ],
          "second"
        );
      }

      rename(source, destination);
    });

    expect(() =>
      writeCodexHooks(
        targetPath,
        [
          {
            event: "Stop",
            generatedId: "first",
            handler: {
              type: "command",
              command: "first",
              statusMessage: "[generated:first] first"
            }
          }
        ],
        "first"
      )
    ).toThrow();
    expect(fs.readFileSync(targetPath, "utf8")).toContain("second");
  });
});
```

2. Run the focused probe:

```sh
npm exec -- vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
```

3. Remove the disposable probe after validation.

The probe passes on the current implementation:

```text
✓ packages/agent-hook-config/src/__probe__.test.ts > Codex hook concurrent publication probe > fails one write when reentrant publication shares the target temporary file
```

## Observed Behavior

The first write stages its generated hook configuration in `/repo/.codex/hooks.json.tmp` and reaches its rename. During that rename, a second valid publication writes new content to exactly the same temporary pathname and renames it into the destination. The first rename then throws because its staging file has been consumed, while the persisted hooks file contains only the second publication.

## Expected Behavior

Each `writeCodexHooks()` invocation should stage through a unique temporary file or otherwise serialize updates to the same destination, so one valid publication cannot consume another valid publication's staging file. A write should not fail solely because another write targeted the same hooks file concurrently.

## Impact

Concurrent hook bridging or repeated updates within one process can produce spurious configuration-write failures despite a valid hooks document being persisted. The failed caller may retry or report an installation/configuration failure, while the resulting active hook configuration reflects whichever competing publication won the timing race rather than a predictable update policy.
