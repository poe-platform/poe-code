# GitHub Workflows Support File Write Failure Leaves Caller Workflow Installed

## Summary

The ordinary `github-workflows install <name>` command installs its caller workflow YAML before creating the shared `variables.yaml` and `README.md` support documents. If support-file persistence fails, the command rejects while the runnable workflow remains installed without the shared configuration assets the installation path promises to create.

## Reproduction

Create a disposable Vitest probe at `packages/github-workflows/src/__probe__.test.ts`:

```ts
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it, vi } from "vitest";
import { vol } from "memfs";

vi.mock("@poe-code/design-system", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@poe-code/design-system")>();
  return { renderTemplate: actual.renderTemplate, select: vi.fn(), isCancel: () => false, cancel: vi.fn() };
});

vi.mock("node:fs/promises", async () => {
  const { fs } = await import("memfs");
  const originalWriteFile = fs.promises.writeFile.bind(fs.promises);
  return {
    ...fs.promises,
    async writeFile(targetPath: string, content: string | Uint8Array, encoding?: BufferEncoding) {
      if (targetPath.endsWith("/variables.yaml")) {
        throw new Error("variables disk full");
      }
      await originalWriteFile(targetPath, content, encoding);
    }
  };
});

const { ghGroup } = await import("./commands.js");

describe("github workflow partial support install", () => {
  it("leaves the caller workflow after shared variables write rejects", async () => {
    vol.reset();
    const promptDir = fileURLToPath(new URL("./prompts", import.meta.url));
    const builtInDir = path.dirname(promptDir);
    const workflowTemplateDir = fileURLToPath(new URL("./workflow-templates", import.meta.url));
    const promptPath = path.join(promptDir, "github-issue-opened.md");
    const templatePath = path.join(workflowTemplateDir, "github-issue-opened.caller.yml");
    const variablesPath = path.join(builtInDir, "variables.yaml");
    vol.fromJSON({
      [promptPath]: readFileSync(promptPath, "utf8"),
      [templatePath]: readFileSync(templatePath, "utf8"),
      [variablesPath]: readFileSync(variablesPath, "utf8")
    });
    vi.spyOn(process, "cwd").mockReturnValue("/repo");
    const installCommand = ghGroup.children.find((child: any) => child.name === "install")!;

    await expect(
      installCommand.handler({ params: { name: "github-issue-opened", eject: false } })
    ).rejects.toThrow("variables disk full");

    expect(vol.existsSync("/repo/.github/workflows/poe-code-github-issue-opened.yml")).toBe(true);
    expect(vol.existsSync("/repo/.github/workflows/variables.yaml")).toBe(false);
    expect(vol.existsSync("/repo/.github/workflows/README.md")).toBe(false);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/github-workflows/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/github-workflows/src/__probe__.test.ts > github workflow partial support install > leaves the caller workflow after shared variables write rejects
```

Remove the disposable probe after validation.

## Observed Behavior

The installation handler first awaits `installAutomation()` for each requested workflow and only afterward calls `ensureProjectSupportFiles()` at `packages/github-workflows/src/commands.ts:208` through `packages/github-workflows/src/commands.ts:242`. `installAutomation()` commits the workflow YAML at `packages/github-workflows/src/commands.ts:771` through `packages/github-workflows/src/commands.ts:800`, while `ensureProjectSupportFiles()` later writes `variables.yaml` and `README.md` at `packages/github-workflows/src/commands.ts:802` through `packages/github-workflows/src/commands.ts:819`. In the probe, writing `variables.yaml` rejects with `variables disk full`, but `.github/workflows/poe-code-github-issue-opened.yml` remains installed and neither support file exists.

## Expected Behavior

Installing a workflow and its required shared support files should be atomic or rollback-safe. If shared setup cannot be written, the command should not leave a newly installed runnable workflow behind while returning a failure.

## Impact

A normal install can fail visibly while still enabling an automation workflow in the repository, without the generated variables and command-reference files expected by maintainers. Users may retry, commit unintended executable workflow state, or encounter confusing runtime failures caused by an installation that reported failure but partially succeeded.
