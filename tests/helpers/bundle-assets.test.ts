import path from "node:path";
import { describe, expect, it } from "vitest";
import { resolveGithubWorkflowAssetCopies } from "../../scripts/bundle-assets.mjs";

describe("resolveGithubWorkflowAssetCopies", () => {
  it("includes prompts and workflow templates for the bundled github-workflows runtime", () => {
    const rootDir = path.join("/repo");

    expect(resolveGithubWorkflowAssetCopies(rootDir)).toEqual([
      {
        sourceDir: path.join("/repo", "packages", "github-workflows", "src", "prompts"),
        targetDir: path.join("/repo", "dist", "prompts"),
        extension: ".md"
      },
      {
        sourceDir: path.join("/repo", "packages", "github-workflows", "src", "workflow-templates"),
        targetDir: path.join("/repo", "dist", "workflow-templates"),
        extension: ".yml"
      }
    ]);
  });
});
