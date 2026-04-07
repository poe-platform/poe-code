import path from "node:path";

export function resolveGithubWorkflowAssetCopies(rootDir) {
  return [
    {
      sourceDir: path.join(rootDir, "packages", "github-workflows", "src", "prompts"),
      targetDir: path.join(rootDir, "dist", "prompts"),
      extension: ".md"
    },
    {
      sourceDir: path.join(rootDir, "packages", "github-workflows", "src", "workflow-templates"),
      targetDir: path.join(rootDir, "dist", "workflow-templates"),
      extension: ".yml"
    }
  ];
}
