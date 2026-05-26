# Pipeline Install Steps YAML Write Failure Leaves Skill Installed

## Summary

`poe-code pipeline install` installs the agent skill and creates its plans directory before it writes the required `steps.yaml` scaffold. If that later configuration write fails, the command rejects after publishing part of the installation, leaving the Pipeline skill active without its required steps file.

## Reproduction

Create a disposable probe at `src/cli/commands/__probe__.test.ts`:

```ts
import { describe, expect, it, vi } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import { Command } from "commander";
import { createCliContainer } from "../container.js";
import type { FileSystem } from "../../utils/file-system.js";
import { registerPipelineCommand } from "./pipeline.js";

const { resolvePipelineLoopAgentMock } = vi.hoisted(() => ({
  resolvePipelineLoopAgentMock: vi.fn().mockResolvedValue({ agent: "claude-code" })
}));

vi.mock("@poe-code/braintrust", () => ({ loadIntegrations: vi.fn() }));
vi.mock("@poe-code/design-system", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@poe-code/design-system")>()),
  isCancel: () => false,
  cancel: vi.fn()
}));
vi.mock("./pipeline-loop-agent.js", () => ({
  resolvePipelineLoopAgent: resolvePipelineLoopAgentMock
}));

describe("pipeline install scaffold write failure probe", () => {
  it("leaves its installed skill behind when steps.yaml creation fails", async () => {
    const volume = new Volume();
    volume.mkdirSync("/repo", { recursive: true });
    volume.mkdirSync("/home/test", { recursive: true });
    const fs = createFsFromVolume(volume).promises as unknown as FileSystem;
    const originalWriteFile = fs.writeFile.bind(fs);
    vi.spyOn(fs, "writeFile").mockImplementation((async (filePath, data, options) => {
      if (String(filePath) === "/repo/.poe-code/pipeline/steps.yaml") {
        throw new Error("injected steps.yaml write failure");
      }
      return originalWriteFile(filePath, data, options);
    }) as FileSystem["writeFile"]);
    const program = new Command();
    program.exitOverride();
    program.name("poe-code").option("-y, --yes").option("--dry-run").option("--verbose");
    registerPipelineCommand(program, createCliContainer({
      fs,
      prompts: vi.fn().mockResolvedValue({}),
      env: { cwd: "/repo", homeDir: "/home/test" },
      logger: () => {}
    }));

    await expect(program.parseAsync([
      "node", "cli", "pipeline", "install", "--agent", "claude-code", "--local"
    ])).rejects.toThrow("injected steps.yaml write failure");
    await expect(fs.readFile(
      "/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md", "utf8"
    )).resolves.toContain("poe-code-pipeline-plan");
    await expect(fs.stat("/repo/.poe-code/pipeline/plans")).resolves.toBeDefined();
    await expect(fs.readFile("/repo/.poe-code/pipeline/steps.yaml", "utf8")).rejects.toThrow();
  });
});
```

Run:

```sh
npm exec -- vitest run src/cli/commands/__probe__.test.ts --reporter verbose
```

The probe passes, demonstrating the partial installation. Remove the disposable probe afterward.

## Observed Behavior

The command rejects with the injected `steps.yaml` creation error, but `/repo/.claude/skills/poe-code-pipeline-plan/SKILL.md` is already installed and `/repo/.poe-code/pipeline/plans` already exists. The required `/repo/.poe-code/pipeline/steps.yaml` configuration file is absent.

## Expected Behavior

Pipeline installation should either publish the complete skill-and-scaffold bundle or leave no newly installed outputs after a required scaffold write fails. Required outputs should be staged before publication or rolled back on failure.

## Impact

Users and automation receive an installation error while the Pipeline skill remains available in an incomplete state. Later commands or retries encounter unexpected existing skill and directory state without a usable steps configuration, making recovery ambiguous and state-dependent.
