import path from "node:path";

export function resolveGithubWorkflowPackageAssetCopies(packageDir, distDir) {
  return [
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
  ];
}

export function resolveGithubWorkflowAssetCopies(rootDir) {
  return resolveGithubWorkflowPackageAssetCopies(
    path.join(rootDir, "packages", "github-workflows"),
    path.join(rootDir, "dist")
  );
}
