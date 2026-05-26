# Harness schema codegen follows a symlinked output file and overwrites outside the repository

## Summary

`runHarnessCodegen()` emits built-in harness JSON schema documents beneath `docs/schemas/harnesses` without rejecting symlinked generated files. A repository containing a symlink at a generated schema path causes routine harness schema generation to overwrite an external target.

## Reproduction

1. From the repository root, save this disposable probe as `.tmp-probes/harness-schema-symlink-probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { runHarnessCodegen } from "../packages/agent-harness/src/codegen/emit-schemas.ts";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-harness-schema-"));
   const repo = path.join(root, "repo");
   const outside = path.join(root, "outside.json");
   await fs.mkdir(path.join(repo, "docs", "schemas", "harnesses"), { recursive: true });
   await fs.writeFile(outside, "{\"external\":true}\n", "utf8");
   await fs.symlink(
     outside,
     path.join(repo, "docs", "schemas", "harnesses", "pipeline-demo.schema.json")
   );

   await runHarnessCodegen({ repoRoot: repo });

   console.log(await fs.readFile(outside, "utf8"));
   console.log(await fs.realpath(path.join(repo, "docs", "schemas", "harnesses", "pipeline-demo.schema.json")));
   ```

2. Execute it with `./node_modules/.bin/tsx .tmp-probes/harness-schema-symlink-probe.mts`.

## Observed Behavior

The external JSON file is overwritten with generated harness schema content containing the `pipeline-demo.schema.json` identifier. The repository-looking schema output path resolves to the external file while generation succeeds.

`runHarnessCodegen()` fixes its generated directory under `repoRoot` in `packages/agent-harness/src/codegen/emit-schemas.ts:34`, derives each output filename from the bundled template kind, and writes it directly with `fs.writeFile()` at `packages/agent-harness/src/codegen/emit-schemas.ts:58` without guarding against a symlinked output file.

## Expected Behavior

Harness schema generation should update only canonical files within the selected repository's `docs/schemas/harnesses` output directory. It should reject generated output paths that resolve outside that repository.

## Impact

A crafted checkout can redirect routine harness-schema regeneration or build workflows into overwriting arbitrary external files with developer or CI privileges. Generated schema updates are a plausible automatic operation and therefore a useful overwrite trigger.
