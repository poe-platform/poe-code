---
name: "GitHub Workflows Bulk Install Later Write Failure Leaves Earlier Workflow Installed"
---

# GitHub Workflows Bulk Install Later Write Failure Leaves Earlier Workflow Installed

## Summary

Calling `github-workflows install` without a workflow name installs all supported automation YAML files sequentially. If a later workflow write fails, the command rejects without removing workflows already installed earlier in the same request, leaving a partially enabled automation set behind.

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
      if (targetPath.endsWith("poe-code-github-issue-comment-created.yml")) {
        throw new Error("second workflow disk full");
      }
      await originalWriteFile(targetPath, content, encoding);
    }
  };
});

const { ghGroup } = await import("./commands.js");

describe("github workflow bulk install failure", () => {
  it("leaves an earlier workflow installed when a later workflow write rejects", async () => {
    vol.reset();
    const promptDir = fileURLToPath(new URL("./prompts", import.meta.url));
    const builtInDir = path.dirname(promptDir);
    const workflowTemplateDir = fileURLToPath(new URL("./workflow-templates", import.meta.url));
    for (const name of ["fix-vulnerabilities", "github-issue-comment-created"]) {
      vol.fromJSON({
        [path.join(promptDir, `${name}.md`)]: readFileSync(path.join(promptDir, `${name}.md`), "utf8"),
        [path.join(workflowTemplateDir, `${name}.caller.yml`)]: readFileSync(
          path.join(workflowTemplateDir, `${name}.caller.yml`),
          "utf8"
        )
      });
    }
    vol.fromJSON({ [path.join(builtInDir, "variables.yaml")]: readFileSync(path.join(builtInDir, "variables.yaml"), "utf8") });
    vi.spyOn(process, "cwd").mockReturnValue("/repo");
    const installCommand = ghGroup.children.find((child: any) => child.name === "install")!;

    await expect(installCommand.handler({ params: { name: undefined, eject: false } })).rejects.toThrow(
      "second workflow disk full"
    );

    expect(vol.existsSync("/repo/.github/workflows/poe-code-fix-vulnerabilities.yml")).toBe(true);
    expect(vol.existsSync("/repo/.github/workflows/poe-code-github-issue-comment-created.yml")).toBe(false);
  });
});
```

Run:

```sh
npm exec -- vitest run packages/github-workflows/src/__probe__.test.ts --reporter verbose
```

The probe passes:

```text
✓ packages/github-workflows/src/__probe__.test.ts > github workflow bulk install failure > leaves an earlier workflow installed when a later workflow write rejects
```

Remove the disposable probe after validation.

## Observed Behavior

When `params.name` is omitted, the install handler creates a list of every `installableAutomations` entry and awaits `installAutomation()` for each one in order at `packages/github-workflows/src/commands.ts:208` through `packages/github-workflows/src/commands.ts:242`. Each individual helper immediately writes its workflow YAML at `packages/github-workflows/src/commands.ts:771` through `packages/github-workflows/src/commands.ts:800`. In the probe, writing the second workflow throws `second workflow disk full`, the command rejects, and the previously written `poe-code-fix-vulnerabilities.yml` remains installed.

## Expected Behavior

Installing the full automation suite should either commit the requested set atomically, roll back workflows written before a later failure, or explicitly return a partial-install result. A rejected bulk installation should not silently leave only a subset enabled.

## Impact

Users running the convenience install-all command can receive a failure while one or more automations have already been activated in the repository. Retrying or committing changes without discovering the partial state can lead to unintended GitHub workflow execution and an inconsistent automation installation set.
