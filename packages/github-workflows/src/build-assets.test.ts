import path from "node:path";
import { createFsFromVolume, Volume } from "memfs";
import { describe, expect, it } from "vitest";
import {
  resolveGithubWorkflowAssetCopies,
  resolveGithubWorkflowPackageAssetCopies
} from "../../../scripts/bundle-assets.mjs";
import { buildGithubWorkflowAssets } from "../scripts/build-assets.js";

describe("resolveGithubWorkflowAssetCopies", () => {
  it("includes variables.yaml alongside prompts and workflow templates", () => {
    const rootDir = "/repo";

    expect(resolveGithubWorkflowAssetCopies(rootDir)).toEqual([
      {
        sourceDir: path.join(rootDir, "packages", "github-workflows", "src", "prompts"),
        targetDir: path.join(rootDir, "dist", "prompts"),
        extension: ".md"
      },
      {
        sourceDir: path.join(rootDir, "packages", "github-workflows", "src", "workflow-templates"),
        targetDir: path.join(rootDir, "dist", "workflow-templates"),
        extension: ".yml"
      },
      {
        sourceDir: path.join(rootDir, "packages", "github-workflows", "src"),
        targetDir: path.join(rootDir, "dist"),
        extension: ".yaml"
      }
    ]);
  });
});

describe("resolveGithubWorkflowPackageAssetCopies", () => {
  it("copies prompts, workflow templates, and variables into the package dist directory", () => {
    const packageDir = path.join("/repo", "packages", "github-workflows");
    const distDir = path.join(packageDir, "dist");

    expect(resolveGithubWorkflowPackageAssetCopies(packageDir, distDir)).toEqual([
      {
        sourceDir: path.join(packageDir, "src", "prompts"),
        targetDir: path.join(distDir, "prompts"),
        extension: ".md"
      },
      {
        sourceDir: path.join(packageDir, "src", "workflow-templates"),
        targetDir: path.join(distDir, "workflow-templates"),
        extension: ".yml"
      },
      {
        sourceDir: path.join(packageDir, "src"),
        targetDir: distDir,
        extension: ".yaml"
      }
    ]);
  });

  it("rejects a symlinked asset output directory outside package dist", async () => {
    const packageDir = "/repo/packages/github-workflows";
    const distDir = path.join(packageDir, "dist");
    const volume = Volume.fromJSON({
      [path.join(packageDir, "src/prompts/probe.md")]: "prompt",
      [path.join(packageDir, "src/workflow-templates/probe.yml")]: "workflow",
      [path.join(packageDir, "src/variables.yaml")]: "variables",
      "/outside/probe.md": "sentinel"
    });
    volume.mkdirSync(distDir, { recursive: true });
    volume.symlinkSync("/outside", path.join(distDir, "prompts"));
    const fs = createFsFromVolume(volume).promises;

    await expect(buildGithubWorkflowAssets({ packageDir, distDir, fs })).rejects.toThrow(
      "output directory must remain inside the package directory"
    );
    await expect(fs.readFile("/outside/probe.md", "utf8")).resolves.toBe("sentinel");
  });
});
