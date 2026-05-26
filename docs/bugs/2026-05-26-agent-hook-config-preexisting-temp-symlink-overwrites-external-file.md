# Agent Hook Config pre-existing temp symlink overwrites external file

## Summary

The exported `@poe-code/agent-hook-config` `writeCodexHooks()` function stages new Codex hook content at the predictable path `${targetPath}.tmp` without rejecting symbolic links. If that temporary pathname is already a symlink to an external file, normal hook publication overwrites the external file before attempting the atomic rename.

## Reproduction

From the repository root, create and run this disposable in-memory Vitest probe:

```sh
cat > packages/agent-hook-config/src/__probe__.test.ts <<'EOF'
import * as fs from "node:fs";
import { vol } from "memfs";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("node:fs", async () => {
  const { fs: memoryFs } = await import("memfs");
  return { ...memoryFs, default: memoryFs };
});

const { writeCodexHooks } = await import("./write-hooks.js");

describe("Codex hook temporary symlink redirection", () => {
  beforeEach(() => {
    vol.reset();
    vi.restoreAllMocks();
  });

  it("overwrites an external file through a pre-existing temporary symlink before rename fails", () => {
    const targetPath = "/repo/.codex/hooks.json";
    const externalPath = "/outside/controlled.json";
    vol.fromJSON({
      [targetPath]: '{"hooks":{}}\n',
      [externalPath]: "external-original\n"
    }, "/");
    vol.symlinkSync(externalPath, `${targetPath}.tmp`);
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw new Error("rename blocked");
    });

    expect(() => writeCodexHooks(targetPath, [{
      event: "Stop",
      generatedId: "generated-probe",
      handler: {
        type: "command",
        command: "notify",
        statusMessage: "[generated:probe] notify"
      }
    }], "probe")).toThrow("rename blocked");

    const outside = fs.readFileSync(externalPath, "utf8");
    const target = fs.readFileSync(targetPath, "utf8");
    console.log(JSON.stringify({ outside, target }));
    expect(outside).toContain("[generated:probe] notify");
    expect(target).toBe('{"hooks":{}}\n');
  });
});
EOF
npm exec -- vitest run packages/agent-hook-config/src/__probe__.test.ts --reporter verbose
rm packages/agent-hook-config/src/__probe__.test.ts
```

The probe passes and prints that only the external file was overwritten before publication failed:

```text
{"outside":"{\n  \"hooks\": {\n    \"Stop\": [\n      {\n        \"hooks\": [\n          {\n            \"type\": \"command\",\n            \"command\": \"notify\",\n            \"statusMessage\": \"[generated:probe] notify\"\n          }\n        ]\n      }\n    ]\n  }\n}\n","target":"{\"hooks\":{}}\n"}
```

## Observed Behavior

An existing valid target hooks file remains unchanged after `renameSync()` is forced to fail, but the external path addressed by a pre-planted `${targetPath}.tmp` symlink already contains the generated hook payload. The write side effect therefore occurs before the reported publication failure.

`writeCodexHooks()` constructs the temporary filename directly from the caller-selected target path at `packages/agent-hook-config/src/write-hooks.ts:96` through `packages/agent-hook-config/src/write-hooks.ts:109`. It calls `writeFileSync(temporaryPath, ...)` without creating a new exclusive regular file or validating the resolved location, so a symbolic link at that staging pathname is followed and overwritten before `renameSync(temporaryPath, targetPath)` is attempted.

## Expected Behavior

Writing a Codex hooks file should stage content only in a newly created regular file within the intended hooks directory. A pre-existing symbolic link at the temporary path should be rejected without modifying its destination or the target configuration.

## Impact

A crafted repository, local workspace, or concurrent actor able to place the predictable temporary symlink can redirect a routine hook-bridging write into an arbitrary writable external file with the process's privileges. The operation may then fail while still corrupting unrelated content outside the intended Codex hook configuration path.
