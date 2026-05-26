# Experiment Install Run YAML Write Failure Leaves Skill Installed

## Summary

`poe-code experiment install` installs the agent skill before it scaffolds the experiment `run.yaml` file. If creation of `run.yaml` fails, the command rejects after the skill and experiment directory have already been committed, leaving a partial installation despite reporting failure.

## Reproduction

Create a disposable probe at `src/cli/commands/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerExperimentCommand } from "./experiment.js";

vi.mock("@poe-code/braintrust", () => ({ loadIntegrations: vi.fn() }));
vi.mock("@poe-code/design-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/design-system")>()),
  isCancel: () => false,
  cancel: vi.fn()
}));

describe("experiment install scaffold write failure probe", () => {
  it("leaves its installed skill behind when run.yaml creation fails", async () => {
    const volume = new Volume();
    volume.mkdirSync("/repo", { recursive: true });
    volume.mkdirSync("/home/test", { recursive: true });
    const fs = createFsFromVolume(volume).promises as unknown as FileSystem;
    const originalWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation((async (filePath, data, options) => {
      if (String(filePath) === "/repo/.poe-code/experiments/run.yaml") {
        throw new Error("injected run.yaml write failure");
      }
      return originalWriteFile(filePath, data, options);
    }) as FileSystem["writeFile"]);
    const program = new Command();
    program.exitOverride();
    program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
    registerExperimentCommand(program, createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      logger: () => {}
    }));

    await expect(program.parseAsync([
      "node", "cli", "experiment", "install", "--agent", "claude-code", "--local"
    ])).rejects.toThrow("injected run.yaml write failure");
    await expect(fs.readFile(
      "/repo/.claude/skills/poe-code-experiment-plan/SKILL.md", "utf8"
    )).resolves.toContain("poe-code-experiment-plan");
    await expect(fs.stat("/repo/.poe-code/experiments")).resolves.toBeDefined();
    await expect(fs.readFile("/repo/.poe-code/experiments/run.yaml", "utf8")).rejects.toThrow();
  });
});
```

Run:

```sh
npm exec -- vitest run src/cli/commands/__probe__.test.ts --reporter verbose
```

The probe passes, demonstrating the failure state. Remove the disposable probe afterward.

## Observed Behavior

The `experiment install` command rejects with the injected `run.yaml` write error, but `/repo/.claude/skills/poe-code-experiment-plan/SKILL.md` is already installed and `/repo/.poe-code/experiments` already exists. The required `/repo/.poe-code/experiments/run.yaml` scaffold is missing.

## Expected Behavior

A failed experiment installation should not leave an installed skill or newly created scaffold directory behind. The command should stage all required outputs before publication or roll back previously created outputs if a later required write fails.

## Impact

Callers receive a failed install result while the filesystem contains a partially enabled Experiment feature. A retry or subsequent run observes mixed state, and users may believe no installation occurred even though the agent skill is already active without its required project configuration.
