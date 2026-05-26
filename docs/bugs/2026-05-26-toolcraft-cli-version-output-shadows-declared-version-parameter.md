# Toolcraft CLI version output shadows declared version parameter

## Summary

The public `toolcraft/cli` `runCLI()` adapter allows a CLI-scoped command to declare a parameter named `version` and exposes it as `--version`, but fails to reserve that flag when program version output is configured. The same valid command invocation that dispatches normally without `options.version` instead prints the package version and never invokes the command handler once `runCLI(root, { version: "..." })` is used.

## Reproduction

Create the disposable probe `packages/toolcraft/src/__probe__.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { S } from "toolcraft-schema";

import { runCLI } from "./cli.js";
import { defineCommand, defineGroup } from "./index.js";

function createRoot(observed: unknown[]) {
  return defineGroup({
    name: "probe",
    children: [
      defineCommand({
        name: "submit",
        scope: ["cli"],
        params: S.Object({ version: S.String() }),
        async handler({ params }) { observed.push(params); return "ok"; }
      })
    ]
  });
}

describe("CLI version parameter collision", () => {
  const originalArgv = process.argv;
  afterEach(() => {
    process.argv = originalArgv;
    process.exitCode = undefined;
    vi.restoreAllMocks();
  });

  it("loses a valid --version parameter only when program version output is configured", async () => {
    const normal: unknown[] = [];
    process.argv = ["node", "probe", "submit", "--version", "release", "--yes"];
    await runCLI(createRoot(normal));

    const versioned: unknown[] = [];
    const writes: string[] = [];
    vi.spyOn(process.stdout, "write").mockImplementation((chunk) => {
      writes.push(String(chunk));
      return true;
    });
    process.argv = ["node", "probe", "submit", "--version", "release", "--yes"];
    await runCLI(createRoot(versioned), { version: "1.2.3" });

    console.log(`normal=${JSON.stringify(normal)} versioned=${JSON.stringify(versioned)} out=${writes.join("")}`);
    expect(normal).toEqual([{ version: "release" }]);
    expect(versioned).toEqual([]);
    expect(writes.join("")).toContain("1.2.3");
  });
});
```

Run the probe, then remove it:

```sh
npm exec -- vitest run packages/toolcraft/src/__probe__.test.ts --reporter verbose
rm -f packages/toolcraft/src/__probe__.test.ts
```

## Observed Behavior

The probe passes and prints:

```text
normal=[{"version":"release"}] versioned=[] out=1.2.3
✓ packages/toolcraft/src/__probe__.test.ts > CLI version parameter collision > loses a valid --version parameter only when program version output is configured
```

Toolcraft builds a global flag set for collision checking using `getGlobalLongOptionFlags()` at `packages/toolcraft/src/cli.ts:1018` through `packages/toolcraft/src/cli.ts:1023`, but that set includes `--yes`, `--output`, `--debug`, `--verbose`, and optionally `--preset` only; it never includes `--version`. `createNodeCommand()` therefore registers the schema field as `--version <value>` at `packages/toolcraft/src/cli.ts:1810` through `packages/toolcraft/src/cli.ts:1841`. Later, `runCLI()` separately enables Commander’s program-level `--version` handler when `options.version` is present at `packages/toolcraft/src/cli.ts:4418` through `packages/toolcraft/src/cli.ts:4429`. During the versioned invocation, Commander consumes the field spelling as its version request, prints `1.2.3`, and skips the command handler entirely.

## Expected Behavior

When `runCLI()` is configured with a program version, Toolcraft should treat `--version` as reserved during command parameter generation and reject or safely remap any colliding schema field, just as it does for other global options. A parameter accepted by an otherwise identical command tree must not become inaccessible merely because application metadata includes a version string.

## Impact

CLI packages generated from external request schemas can expose a legitimate field named `version` successfully during development, then silently lose the entire command invocation after enabling normal package-version output for distribution. Users attempting to submit the field receive a version banner instead of performing the requested action, with no collision diagnostic explaining that their input was ignored.
