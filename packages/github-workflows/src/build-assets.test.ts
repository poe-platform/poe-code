import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  resolveGithubWorkflowAssetCopies,
  resolveGithubWorkflowPackageAssetCopies
} from "../../../scripts/bundle-assets.mjs";

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
});
