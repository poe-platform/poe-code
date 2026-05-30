---
name: "GitHub Workflows Ejected Install Prompt Write Failure Leaves Workflow Installed"
---

# GitHub Workflows Ejected Install Prompt Write Failure Leaves Workflow Installed

## Summary

The `github-workflows install --eject` command writes the executable workflow YAML before it writes the local editable prompt copy. If writing the prompt file fails, the install command rejects while the workflow YAML remains installed and eligible to run without its expected accompanying prompt asset.

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
      if (targetPath.endsWith("poe-code-github-issue-opened.md")) {
        throw new Error("prompt disk full");
      }
      await originalWriteFile(targetPath, content, encoding);
    }
  };
});

const { ghGroup } = await import("./commands.js");

function getInstallCommand() {
  return ghGroup.children.find((child: any) => child.name === "install")!;
}

describe("github workflow partial ejected install", () => {
  it("leaves the workflow yaml after its prompt copy rejects", async () => {
    vol.reset();
    const promptDir = fileURLToPath(new URL("./prompts", import.meta.url));
    const workflowTemplateDir = fileURLToPath(new URL("./workflow-templates", import.meta.url));
    const promptPath = path.join(promptDir, "github-issue-opened.md");
    const templatePath = path.join(workflowTemplateDir, "github-issue-opened.ejected.yml");
    vol.fromJSON({
      [promptPath]: readFileSync(promptPath, "utf8"),
      [templatePath]: readFileSync(templatePath, "utf8")
    });
    vi.spyOn(process, "cwd").mockReturnValue("/repo");

    await expect(
      getInstallCommand().handler({ params: { name: "github-issue-opened", eject: true } })
    ).rejects.toThrow("prompt disk full");

    expect(vol.existsSync("/repo/.github/workflows/poe-code-github-issue-opened.yml")).toBe(true);
    expect(vol.existsSync("/repo/.github/workflows/poe-code-github-issue-opened.md")).toBe(false);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/github-workflows/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/github-workflows/src/__probe__.test.ts > github workflow partial ejected install > leaves the workflow yaml after its prompt copy rejects
```

Remove the disposable probe after validation.

## Observed Behavior

The `install` handler installs each selected automation before creating shared support files at `packages/github-workflows/src/commands.ts:208` through `packages/github-workflows/src/commands.ts:242`. For ejected installs, `installAutomation()` writes `.github/workflows/poe-code-<name>.yml` first and only then writes its colocated prompt Markdown file at `packages/github-workflows/src/commands.ts:771` through `packages/github-workflows/src/commands.ts:800`. In the probe, the prompt write throws `prompt disk full`, the handler rejects, and `.github/workflows/poe-code-github-issue-opened.yml` remains on disk while its expected `.md` prompt does not exist.

## Expected Behavior

An ejected workflow installation should be atomic across the generated workflow and prompt assets, or roll back files created before a later install step fails. A rejected install should not leave a runnable workflow partially installed.

## Impact

A disk, permission, or path-specific failure while copying the customizable prompt can leave automation unexpectedly enabled even though the command reports installation failure. Subsequent GitHub events may trigger a workflow missing the intended local prompt/configuration, and users may retry installation without realizing partial executable state is already committed.
