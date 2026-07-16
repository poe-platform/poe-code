const clonableSchemes = ["https", "http", "ssh", "git", "file"];
const schemeSeparator = "://";

export function assertClonableTargetRepo(repo: string): void {
  const separatorAt = repo.indexOf(schemeSeparator);
  if (separatorAt === -1) {
    return;
  }

  const scheme = repo.slice(0, separatorAt);
  if (clonableSchemes.includes(scheme)) {
    return;
  }

  throw new Error(
    `target.repo ${JSON.stringify(repo)} uses unsupported scheme "${scheme}". Git cannot clone it. Use a git-clonable target such as https://github.com/owner/repo.git, ssh://git@github.com/owner/repo.git, or a local path.`
  );
}
