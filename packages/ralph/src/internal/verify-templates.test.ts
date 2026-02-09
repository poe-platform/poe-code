import { describe, expect, it } from "vitest";
import { Volume, createFsFromVolume } from "memfs";
import path from "node:path";
import { verifyBundledTemplates } from "./verify-templates.js";

function createPackageFs(filePaths: string[]): {
  fs: typeof import("node:fs/promises");
  packageRoot: string;
} {
  const workspaceRoot = "/project";
  const packageRoot = path.posix.join(workspaceRoot, "packages", "ralph");

  const json: Record<string, string> = {};
  for (const filePath of filePaths) {
    json[path.posix.join(packageRoot, filePath)] = "content";
  }

  const vol = Volume.fromJSON(json, workspaceRoot);
  const memfs = createFsFromVolume(vol);
  return { fs: memfs.promises as any, packageRoot };
}

describe("verifyBundledTemplates()", () => {
  it("passes when all required templates exist", async () => {
    const { fs, packageRoot } = createPackageFs([
      "templates/.poe-code-ralph/progress.md",
      "templates/.poe-code-ralph/guardrails.md",
      "templates/.poe-code-ralph/errors.log",
      "templates/.poe-code-ralph/activity.log"
    ]);

    await expect(verifyBundledTemplates({ fs, packageRoot })).resolves.toBe(
      undefined
    );
  });

  it("throws with missing template paths", async () => {
    const { fs, packageRoot } = createPackageFs([
      "templates/.poe-code-ralph/progress.md"
    ]);

    await expect(verifyBundledTemplates({ fs, packageRoot })).rejects.toThrow(
      "templates/.poe-code-ralph/guardrails.md"
    );
  });
});

