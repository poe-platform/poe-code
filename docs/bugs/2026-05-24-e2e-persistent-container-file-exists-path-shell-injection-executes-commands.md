# E2E persistent container fileExists path shell injection executes commands

## Summary

`createPersistentContainer()` implements `Container.fileExists(filePath)` as an unquoted `test -f <path>` shell command. Shell syntax in a purported path is executed, and can also force the existence check to return a false-positive result.

## Reproduction

1. From the repository root, save this disposable probe as `probe.mts`:

   ```ts
   import fs from "node:fs/promises";
   import os from "node:os";
   import path from "node:path";

   const root = await fs.mkdtemp(path.join(os.tmpdir(), "poe-persistent-exists-inject-"));
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
     const exists = await container.fileExists(
       `/definitely-missing; printf injected > ${marker}; true`
     );
     console.log(exists, await fs.readFile(marker, "utf8"));
   } finally {
     await container.destroy();
   }
   ```

2. Execute it with `./node_modules/.bin/tsx ./probe.mts`.

## Observed Behavior

The probe prints `true injected`. The requested `/definitely-missing` file is absent, but the injected shell payload creates the marker and forces `fileExists()` to return `true`.

`Container.fileExists()` passes `` `test -f ${filePath}` `` to `execQuiet()` in `packages/e2e-test-runner/src/persistent-container.ts:387`; the resulting command is executed using `sh -c` without escaping the path argument.

## Expected Behavior

`fileExists(filePath)` should perform a boolean check on the literal path supplied, without executing shell expressions or allowing an attacker-controlled path to forge the result.

## Impact

A caller can turn an existence assertion into arbitrary command execution inside the persistent container and simultaneously falsify the boolean check. This can undermine test safety and correctness in Podman-backed E2E workflows.
