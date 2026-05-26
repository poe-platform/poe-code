# Toolcraft OpenAPI follows a symlinked generated-output directory and writes outside the project

## Summary

`toolcraft-openapi-generate` uses the default project-relative output directory `src/generated` without checking whether that path is a symlink. A project-local `src/generated` symlink can therefore redirect normal generator output into an arbitrary external directory.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { runGenerateCli } from "./packages/toolcraft-openapi/src/bin/generate.ts";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-openapi-output-"));
   const project = path.join(root, "project");
   const outside = path.join(root, "outside-generated");
   const spec = JSON.stringify({
     openapi: "3.0.3",
     info: { title: "Probe", version: "1.0.0" },
     paths: {}
   }, null, 2);

   await fs.mkdir(path.join(project, "src"), { recursive: true });
   await fs.mkdir(outside, { recursive: true });
   await fs.writeFile(path.join(project, "openapi.json"), spec, "utf8");
   await fs.symlink(outside, path.join(project, "src", "generated"));

   await runGenerateCli(["node", "generate"], {
     cwd: project,
     fetch: globalThis.fetch,
     fs,
     stdout: { write: () => true },
     stderr: { write: () => true }
   });

   console.log(await fs.readFile(path.join(outside, "index.ts"), "utf8"));
   console.log(await fs.realpath(path.join(project, "src", "generated")));
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The generator exits successfully and creates `index.ts` inside `outside-generated`, even though no external output path was supplied. In the confirmed probe, `fs.realpath(project/src/generated)` resolved to the external directory and its `index.ts` contained the generated Toolcraft module header.

`syncGeneratedClient()` resolves the lexical path under `services.cwd` in `packages/toolcraft-openapi/src/bin/generate.ts:133`, and `writeGeneratedFiles()` later writes the resolved file paths through `fs.writeFile()` in `packages/toolcraft-openapi/src/bin/generate.ts:333` without validating the real output location.

## Expected Behavior

Using the default project-relative output path should not cause generated files to be written outside the project through a pre-existing symlink. The generator should reject symlink escapes or otherwise confine output writes to the intended project tree.

## Impact

A repository or workspace containing a crafted `src/generated` symlink can cause routine code-generation commands to overwrite files outside that repository with the privileges of the running user or automation process. This is particularly risky in CI, agent-driven workspaces, and local development where generation may be invoked without reviewing existing filesystem links.
