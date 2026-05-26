# Agent Harness Failed Host Call Record Write Corrupts Prior Replay Journal

## Summary

`@poe-code/agent-harness` persists snapshot resume host-call records by overwriting the active `.host-calls.json` journal directly. If recording a newly completed host call partially changes the journal before rejecting, `runHarnessPair()` fails and destroys previously valid replay records needed for recovery.

## Reproduction

Create a disposable Vitest probe at `packages/agent-harness/src/loader/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

let failedStorePath: string | undefined;

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  return {
    ...fs.promises,
    async writeFile(path: Parameters<typeof fs.promises.writeFile>[0], data: Parameters<typeof fs.promises.writeFile>[1], options?: Parameters<typeof fs.promises.writeFile>[2]) {
      if (path === failedStorePath) {
        await fs.promises.writeFile(path, "[", options);
        throw new Error("host call disk full");
      }
      await fs.promises.writeFile(path, data, options);
    },
    default: fs.promises
  };
});

const { runHarnessPair } = await import("./run.js");

describe("agent harness interrupted host-call record write", () => {
  it("destroys prior replay records when appending a live host result rejects", async () => {
    vol.reset();
    const mdPath = "/repo/harness/replay.md";
    const snapshotPath = "/snapshots/replay.json";
    const storePath = `${snapshotPath}.host-calls.json`;
    vol.fromJSON({
      [mdPath]: "---\nkind: replay\nversion: 1\n---\n",
      "/repo/harness/replay.ajs": [
        'import { step } from "host";',
        "export default async () => await step('new');"
      ].join("\n"),
      [storePath]: JSON.stringify([{ key: "host.step", args: ["old"], result: "preserved" }])
    });
    failedStorePath = storePath;

    await expect(runHarnessPair(mdPath, {
      modulesFor: () => ({ host: { async step() { return "new"; } } }),
      snapshotPath
    })).rejects.toThrow("host call disk full");

    const raw = vol.readFileSync(storePath, "utf8") as string;
    console.log(JSON.stringify({ raw }));
    expect(raw).toBe("[");
  });
});
```

Run:

```sh
npm exec -- vitest run packages/agent-harness/src/loader/__probe__.test.ts --reporter verbose
```

The probe passes and prints:

```text
{"raw":"["}
✓ packages/agent-harness/src/loader/__probe__.test.ts > agent harness interrupted host-call record write > destroys prior replay records when appending a live host result rejects
```

Remove the disposable probe after validation.

## Observed Behavior

`runHarnessPair()` creates replay persistence for its snapshot path at `packages/agent-harness/src/loader/run.ts:117`. Each live host result is appended in memory and sent to `writeHostCallRecords()` at `packages/agent-harness/src/loader/run.ts:501` through `packages/agent-harness/src/loader/run.ts:516`. That helper serializes all records and directly overwrites the active journal with `writeFile()` at `packages/agent-harness/src/loader/run.ts:536` through `packages/agent-harness/src/loader/run.ts:548`. In the probe, the newly completed host call causes `runHarnessPair()` to reject with `"host call disk full"`, but the previously valid replay journal has already been replaced by malformed JSON `"["`.

## Expected Behavior

Recording an additional host call should not destroy prior valid recovery state when persistence cannot complete. Replay journals should be committed atomically or preserve the previous readable record set on a rejected write.

## Impact

An interrupted journal write during a snapshot-enabled harness run can remove already recorded host results that resume relies on to avoid repeating side effects. A later recovery attempt cannot parse the corrupted journal, so a transient storage failure can turn into lost replay state and prevent safe workflow resumption.
