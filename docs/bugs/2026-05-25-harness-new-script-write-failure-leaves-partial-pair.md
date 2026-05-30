---
name: "Harness New Script Write Failure Leaves Partial Pair"
---

# Harness New Script Write Failure Leaves Partial Pair

## Summary

The CLI `harness new` command scaffolds the Markdown prompt and agent-script files concurrently without rollback. If one paired write fails after the other succeeds, the command rejects but leaves a partial harness pair visible at the requested destination.

## Reproduction

Create a disposable Vitest probe at `src/cli/commands/__probe__.test.ts`:

```ts
import { fs as memfs, vol } from "memfs";
import { Command } from "commander";
import { expect, it, vi } from "vitest";

import type { FileSystem } from "../../utils/file-system.js";
import { createCliContainer } from "../container.js";

vi.mock("node:fs/promises", async () => ({ ...memfs.promises, default: memfs.promises }));
vi.mock("@poe-code/agent-harness", async () => {
  const actual = await vi.importActual<typeof import("@poe-code/agent-harness")>("@poe-code/agent-harness");
  return {
    ...actual,
    listBuiltinTemplates: () => [{ kind: "demo", mdPath: "/templates/demo.md", ajsPath: "/templates/demo.ajs" }]
  };
});
vi.mock("../../providers/index.js", () => ({ getDefaultProviders: () => [] }));

const { registerHarnessCommand } = await import("./harness.js");

it("leaves a partial pair after the agent-script scaffold write fails", async () => {
  vol.reset();
  vol.fromJSON({
    "/repo/.keep": "",
    "/home/.keep": "",
    "/templates/demo.md": "---\nkind: demo\nversion: 1\n---\n# Demo\n",
    "/templates/demo.ajs": "export default () => true;\n"
  }, "/");
  const fs: FileSystem = {
    ...(memfs.promises as unknown as FileSystem),
    async writeFile(filePath, content, options) {
      if (String(filePath).endsWith("example.ajs")) {
        throw new Error("script write failed");
      }
      await memfs.promises.writeFile(filePath, content, options);
    }
  };
  const container = createCliContainer({
    fs,
    prompts: vi.fn().mockResolvedValue({}),
    env: { cwd: "/repo", homeDir: "/home" },
    logger: vi.fn(),
    commandRunner: vi.fn().mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" })
  });
  const program = new Command().exitOverride().name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
  registerHarnessCommand(program, container);

  await expect(program.parseAsync(["node", "cli", "--yes", "harness", "new", "demo", "example"]))
    .rejects.toThrow("script write failed");
  await expect(memfs.promises.readFile("/repo/.poe-code/harnesses/example/example.md", "utf8"))
    .resolves.toContain("# Demo");
  await expect(memfs.promises.readFile("/repo/.poe-code/harnesses/example/example.ajs", "utf8"))
    .rejects.toThrow();
});
```

Run:

```sh
npm exec -- vitest run src/cli/commands/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ src/cli/commands/__probe__.test.ts > leaves a partial pair after the agent-script scaffold write fails
```

Remove the disposable probe after validation.

## Observed Behavior

`executeHarnessNew()` resolves two target file paths, verifies that neither currently exists, creates the destination directory, and writes the `.md` and `.ajs` files concurrently through `Promise.all()` at `src/cli/commands/harness.ts:286` through `src/cli/commands/harness.ts:333`. In the probe, the Markdown write succeeds while the agent-script write rejects with `script write failed`; the public command rejects, but `.poe-code/harnesses/example/example.md` remains on disk with the scaffold while `example.ajs` is absent.

## Expected Behavior

Creating a harness pair should publish both paired files together or remove any newly created output when either write fails. A rejected `harness new` command should not leave an incomplete pair that looks discoverable or blocks a clean retry.

## Impact

Transient write failures during harness scaffolding can strand prompt files without their executable script counterparts. Users and automation receive a failed creation result but must manually clean up the incomplete destination before retrying, and discovery or later edits can encounter a malformed harness setup left by the failed command.
