# Agent Harness schema codegen failure leaves partially updated public schema set

## Summary

`@poe-code/agent-harness` generates the public JSON Schema files for its built-in harness templates by writing each output file directly and sequentially into `docs/schemas/harnesses`. If a later schema write fails after an earlier schema has been committed, `runHarnessCodegen()` rejects while leaving the published schema set partially updated. There is no staging directory or rollback mechanism for the logically related generated documentation artifacts.

## Reproduction

Create a disposable Vitest probe at `packages/agent-harness/src/codegen/__probe__.test.ts`:

```ts
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import { runHarnessCodegen } from "./emit-schemas.js";

describe("harness schema emission failure probe", () => {
  it("leaves an earlier new schema committed when a later schema write fails", async () => {
    const volume = Volume.fromJSON({
      "/repo/docs/schemas/harnesses/coverage-demo.schema.json": "old coverage schema\n",
      "/repo/docs/schemas/harnesses/experiment-demo.schema.json": "old experiment schema\n"
    }, "/");
    const rawFs = createFsFromVolume(volume).promises;
    let writeCount = 0;
    const fs = {
      mkdir: rawFs.mkdir.bind(rawFs),
      writeFile: async (filePath: string, data: string, options?: BufferEncoding | { encoding?: BufferEncoding }) => {
        writeCount += 1;
        if (writeCount === 2) throw new Error("simulated later schema failure");
        await rawFs.writeFile(filePath, data, options);
      }
    };

    await expect(runHarnessCodegen({ repoRoot: "/repo", fs })).rejects.toThrow(
      "simulated later schema failure"
    );
    await expect(rawFs.readFile("/repo/docs/schemas/harnesses/coverage-demo.schema.json", "utf8"))
      .resolves.not.toBe("old coverage schema\n");
    await expect(rawFs.readFile("/repo/docs/schemas/harnesses/experiment-demo.schema.json", "utf8"))
      .resolves.toBe("old experiment schema\n");
  });
});
```

Run the probe:

```sh
npm exec -- vitest run packages/agent-harness/src/codegen/__probe__.test.ts --reporter verbose
```

The probe passes. Remove `packages/agent-harness/src/codegen/__probe__.test.ts` afterward.

## Observed Behavior

- The probe starts with old published placeholders for the first two alphabetical built-in schema outputs: `coverage-demo.schema.json` and `experiment-demo.schema.json`.
- The injected filesystem accepts the first generated schema write, then rejects the second with `simulated later schema failure`.
- `runHarnessCodegen()` rejects, but `coverage-demo.schema.json` no longer contains its old value while `experiment-demo.schema.json` still does.
- In `packages/agent-harness/src/codegen/emit-schemas.ts`, `runHarnessCodegen()` sorts templates and executes one direct `fs.writeFile(...)` per schema inside a loop, with no temporary output set or restoration if a later write fails.

## Expected Behavior

Generation of the public built-in schema set should publish one coherent version or preserve the prior set on failure. A rejected codegen invocation should not leave only an alphabetical prefix regenerated while later schemas remain stale.

## Impact

A transient write error during schema regeneration can make published/documentation schema files represent inconsistent template versions. Consumers validating harness documents against generated schemas may observe differing contracts depending on template kind until the generation process is rerun successfully or files are manually restored.
