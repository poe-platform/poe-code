# Agent harness tools workflow-doc subdirectory traversal reads outside state roots

## Summary

The exported `discoverWorkflowDocs()` helper accepts a `subDirectory` value and appends it directly to both `<cwd>/.poe-code/` and `<homeDir>/.poe-code/` without enforcing containment. Supplying `../../secrets` escapes both workflow-state directories and returns arbitrary matching Markdown files from outside the managed roots.

## Reproduction

Create a disposable probe at `packages/agent-harness-tools/src/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { discoverWorkflowDocs } from "./paths.js";

describe("discoverWorkflowDocs subDirectory traversal", () => {
  it("discovers markdown outside the managed workflow directories", async () => {
    const fs = createFsFromVolume(Volume.fromJSON({
      "/repo/secrets/outside.md": "external project doc\n",
      "/home/test/secrets/global.md": "external global doc\n",
    }, "/")).promises;

    const docs = await discoverWorkflowDocs({
      cwd: "/repo/project",
      homeDir: "/home/test/user",
      subDirectory: "../../secrets",
      fs: fs as { readdir: (path: string) => Promise<string[]> },
    });

    console.log(JSON.stringify(docs));
    expect(docs).toEqual(["/home/test/secrets/global.md", "/repo/secrets/outside.md"]);
  });
});
```

Run the probe and remove it afterwards:

```sh
npm exec -- vitest run packages/agent-harness-tools/src/__probe__.test.ts --reporter verbose
rm packages/agent-harness-tools/src/__probe__.test.ts
```

## Observed Behavior

The test passes and prints documents outside either `.poe-code` state root:

```text
["/home/test/secrets/global.md","/repo/secrets/outside.md"]
```

In `packages/agent-harness-tools/src/paths.ts`, `discoverWorkflowDocs()` forms `projectDirectory` and `globalDirectory` through `path.join(..., options.subDirectory)` and immediately enumerates them. For `subDirectory: "../../secrets"`, Node normalizes the resulting paths to `/repo/secrets` and `/home/test/secrets`, respectively.

## Expected Behavior

An API documented as discovering workflow documents beneath project and user `.poe-code` directories should reject traversal segments or confirm that the resolved search directory remains inside its configured workflow root before enumerating files.

## Impact

Callers that expose or derive `subDirectory` from workflow type, plugin metadata, or other externally influenced input can unintentionally enumerate and load Markdown documents outside Poe Code state. This permits escaped instructions or sensitive local documents to be surfaced as ordinary discoverable workflow inputs without requiring symbolic links.
