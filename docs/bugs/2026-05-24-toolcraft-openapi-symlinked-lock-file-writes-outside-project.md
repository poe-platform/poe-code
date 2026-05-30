---
name: "Toolcraft OpenAPI follows the default lock-file symlink and overwrites a file outside the project"
---

# Toolcraft OpenAPI follows the default lock-file symlink and overwrites a file outside the project

## Summary

`toolcraft-openapi-generate` writes the default project-local `openapi.lock` path directly. If `openapi.lock` is a symlink, an ordinary generation run follows it and overwrites its external target with generated lock content.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";
   import { runGenerateCli } from "./packages/toolcraft-openapi/src/bin/generate.ts";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-openapi-lock-"));
   const project = path.join(root, "project");
   const outside = path.join(root, "outside");
   const externalLock = path.join(outside, "captured.lock");
   const spec = JSON.stringify({
     openapi: "3.0.3",
     info: { title: "Probe", version: "1.0.0" },
     paths: {}
   }, null, 2);

   await fs.mkdir(project, { recursive: true });
   await fs.mkdir(outside, { recursive: true });
   await fs.writeFile(path.join(project, "openapi.json"), spec, "utf8");
   await fs.symlink(externalLock, path.join(project, "openapi.lock"));

   await runGenerateCli(["node", "generate", "--output", "safe-generated"], {
     cwd: project,
     fetch: globalThis.fetch,
     fs,
     stdout: { write: () => true },
     stderr: { write: () => true }
   });

   console.log(await fs.readFile(externalLock, "utf8"));
   console.log(await fs.realpath(path.join(project, "openapi.lock")));
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The generator exits successfully and creates the external `captured.lock` target through the project-local `openapi.lock` symlink. The external file contains the generated `specSha` JSON lock payload.

`syncGeneratedClient()` obtains the default lexical lock path in `packages/toolcraft-openapi/src/bin/generate.ts:134` and calls `writeOpenApiLock()` at `packages/toolcraft-openapi/src/bin/generate.ts:151`. `writeOpenApiLock()` writes that path directly with `fs.writeFile()` in `packages/toolcraft-openapi/src/lock.ts:67` without checking whether it resolves outside the project.

## Expected Behavior

Using the default `openapi.lock` location should not allow an existing project-local symlink to redirect a write outside the project. The generator should reject symlinked lock targets or safely confine lock writes to the intended project tree.

## Impact

A repository or workspace containing a crafted `openapi.lock` symlink can cause routine generation commands to overwrite an arbitrary external file with lock JSON. This creates a filesystem-write primitive in CI and automated development workflows that process untrusted or partially trusted checkouts.
