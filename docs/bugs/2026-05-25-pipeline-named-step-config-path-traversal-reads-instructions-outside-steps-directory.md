# Pipeline named step config path traversal reads instructions outside the steps directory

## Summary

The exported `loadResolvedSteps()` API accepts a selected named step configuration and interpolates it directly into `<stepsDir>/<name>.yaml`. A name such as `../outside` escapes `.poe-code/pipeline/steps/` and loads executable pipeline instructions from its parent directory without requiring a symlink.

## Reproduction

1. From the repository root, create this disposable Vitest probe using `memfs`:

   ```sh
   cat > packages/pipeline/src/__probe__.test.ts <<'EOF_TEST'
   import { describe, expect, it } from "vitest";
   import { Volume, createFsFromVolume } from "memfs";
   import type { PipelineFileSystem } from "./types.js";
   import { loadResolvedSteps } from "./config/loader.js";

   function createFs(files: Record<string, string>): Pick<PipelineFileSystem, "readFile" | "stat"> {
     return createFsFromVolume(Volume.fromJSON(files)).promises as unknown as Pick<PipelineFileSystem, "readFile" | "stat">;
   }

   describe("pipeline named step config containment", () => {
     it("loads an external step config through traversal in the selected name", async () => {
       const config = await loadResolvedSteps({
         cwd: "/repo",
         homeDir: "/home/test",
         fs: createFs({
           "/repo/.poe-code/pipeline/steps/placeholder.yaml": "steps: {}\n",
           "/repo/.poe-code/pipeline/outside.yaml": "steps:\n  implement:\n    prompt: Escaped instructions\n"
         }),
         name: "../outside"
       });

       expect(config.steps.implement?.prompt).toBe("Escaped instructions");
     });
   });
   EOF_TEST
   npm exec -- vitest run packages/pipeline/src/__probe__.test.ts --reporter verbose
   rm packages/pipeline/src/__probe__.test.ts
   ```

2. The probe passes:

   ```text
   ✓ packages/pipeline/src/__probe__.test.ts > pipeline named step config containment > loads an external step config through traversal in the selected name
   ```

## Observed Behavior

`loadResolvedSteps({ name: "../outside" })` reads `/repo/.poe-code/pipeline/outside.yaml` and returns its `implement` prompt even though the named-steps search root is `/repo/.poe-code/pipeline/steps/`.

`packages/pipeline/src/config/loader.ts:243` through `packages/pipeline/src/config/loader.ts:259` select the configured steps directory. `packages/pipeline/src/config/loader.ts:314` through `packages/pipeline/src/config/loader.ts:353` trim but do not validate `options.name`, then construct `path.join(stepsDir, `${name}.yaml`)` and parse the escaped file as pipeline step configuration.

## Expected Behavior

Named pipeline step selection should accept only simple configuration identifiers whose resolved YAML file remains inside the selected `steps` directory. Values containing traversal components, absolute-path forms, or path separators should be rejected.

## Impact

A pipeline plan or SDK caller that controls the selected step configuration name can import prompts, agent choices, hooks, and skills from files outside the intended named-steps directory. This enables instruction injection through textual traversal and is distinct from redirecting the steps directory with a symbolic link.
