# Plan schema codegen follows a symlinked output file and overwrites outside the repository

## Summary

`runPlanSchemaCodegen()` generates fixed JSON schema files beneath `docs/schemas/plans`, but does not reject symlinks at those generated output paths. A repository containing a symlinked schema file causes normal schema generation to overwrite an arbitrary external file.

## Reproduction

1. From the repository root, save this disposable probe as `.tmp-probes/plan-schema-symlink-probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { runPlanSchemaCodegen } from "../scripts/generate-plan-schemas.ts";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-plan-schema-"));
   const repo = path.join(root, "repo");
   const outside = path.join(root, "outside.json");
   await fs.mkdir(path.join(repo, "docs", "schemas", "plans"), { recursive: true });
   await fs.writeFile(outside, "{\"external\":true}\n", "utf8");
   await fs.symlink(
     outside,
     path.join(repo, "docs", "schemas", "plans", "plan.schema.json")
   );

   await runPlanSchemaCodegen({ repoRoot: repo });

   console.log(await fs.readFile(outside, "utf8"));
   console.log(await fs.realpath(path.join(repo, "docs", "schemas", "plans", "plan.schema.json")));
   ```

2. Execute it with `./node_modules/.bin/tsx .tmp-probes/plan-schema-symlink-probe.mts`.

## Observed Behavior

The external JSON file is replaced with generated plan-schema contents, including a `$schema` property, and the apparent repository output path resolves to that external target. The codegen function completes successfully.

`runPlanSchemaCodegen()` fixes its output directory beneath `repoRoot` in `scripts/generate-plan-schemas.ts:61`, then writes each `planSchemaDocuments` filename through `fs.writeFile()` in `scripts/generate-plan-schemas.ts:65` without canonical containment or symlink checks.

## Expected Behavior

Schema generation should rewrite only canonical output files located within the selected repository's `docs/schemas/plans` directory. It should reject an output path that is a symlink to an external target.

## Impact

A crafted checkout can turn routine plan-schema regeneration or build steps into arbitrary external file overwrites with CI or developer privileges. The affected path is a committed generated artifact commonly updated automatically.
