# Agent hook config generated marker collision deletes user-authored hook

## Summary

`@poe-code/agent-hook-config` identifies previously generated Codex hooks solely by whether their user-visible `statusMessage` starts with `[generated:`. If a user authors an ordinary hook whose status message begins with that text, the next bridge write treats it as stale generated state and deletes the user's command.

## Reproduction

Add the following temporary probe as `packages/agent-hook-config/src/__probe__.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("node:fs", async () => {
  const { fs } = await import("memfs");
  return fs;
});

const { writeCodexHooks } = await import("./write-hooks.js");
const targetPath = "/repo/.codex/hooks.json";

describe("generated-status marker collision", () => {
  beforeEach(() => vol.reset());

  it("deletes a user-authored hook whose status message begins with the marker", () => {
    vol.fromJSON({
      [targetPath]: JSON.stringify({
        hooks: {
          Stop: [{ hooks: [{ type: "command", command: "keep-me", statusMessage: "[generated:notes] user label" }] }]
        }
      })
    }, "/");

    const result = writeCodexHooks(targetPath, [], "new-run");
    const stored = JSON.parse(vol.readFileSync(targetPath, "utf8") as string);

    console.log(JSON.stringify({ result, stored }));
    expect(result.previousGeneratedRemoved).toBe(1);
    expect(stored.hooks.Stop[0]).toBeUndefined();
  });
});
```

Run:

```sh
npm exec vitest run -- packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"result":{"path":"/repo/.codex/hooks.json","fileCreated":false,"previousGeneratedRemoved":1,"generatedWritten":0},"stored":{"hooks":{"Stop":[]}}}
✓ packages/agent-hook-config/src/__probe__.test.ts > generated-status marker collision > deletes a user-authored hook whose status message begins with the marker
```

Remove the temporary probe after confirming the reproduction.

## Observed Behavior

The input hooks file contains a user command named `keep-me`, but calling `writeCodexHooks()` with no generated entries removes it and records one previous generated handler removed. `isGeneratedHandler()` in `packages/agent-hook-config/src/write-hooks.ts` uses only `handler.statusMessage?.startsWith("[generated:")` as provenance, and the stale-handler filtering step deletes every matching entry regardless of whether this package created it.

## Expected Behavior

Bridge cleanup should remove only entries it can reliably associate with its own prior writes, such as entries carrying a collision-resistant private identifier or entries exactly listed in a prior manifest. A user-controlled display label must not be enough to classify and delete a user-owned hook command.

## Impact

Routine hook bridging can silently erase valid user Codex hooks whose status labels happen to use the package's marker-like prefix. This can disable local automation, safety checks, notifications, or user workflows without a warning, while the rewrite reports the deletion as ordinary generated cleanup.
