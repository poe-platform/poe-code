import { resolvePath } from "@poe-code/safe-fs/core";
import { type CommandContext, type CommandDefinition, type CommandHandler } from "safe-bash-contracts";
import {
  getBoolFlag,
  getIntFlag,
  getStringArrayFlag,
  getStringFlag,
  parseCommandArgs,
  type FlagSchema,
} from "../args.js";
import type { GitHubBackend } from "../backend.js";
import { decodeUtf8, encodeUtf8 } from "../crypto-ssh.js";
import {
  findGitRoot,
  parseRepoSpec,
  readCurrentBranch,
  readGitConfig,
  readWorktreeFiles,
  resolveRepoFromContext,
  runGitInVfs,
  setDefaultRepoInGitConfig,
  updateGitRemote,
  writeWorktreeFiles,
} from "../git-vfs.js";
import { formatCommandOutput } from "../template.js";
import type {
  GhBrowserOpener,
  GhDeployKey,
  GhHttpTransport,
  GhLimits,
  GhRepo,
  GhSshProvider,
} from "../types.js";

export const REPO_JSON_FIELDS: readonly string[] = [
  "archivedAt",
  "assignableUsers",
  "codeOfConduct",
  "contactLinks",
  "createdAt",
  "defaultBranchRef",
  "deleteBranchOnMerge",
  "description",
  "diskUsage",
  "forkCount",
  "fundingLinks",
  "hasDiscussionsEnabled",
  "hasIssuesEnabled",
  "hasProjectsEnabled",
  "hasWikiEnabled",
  "homepageUrl",
  "id",
  "isArchived",
  "isBlankIssuesEnabled",
  "isEmpty",
  "isFork",
  "isInOrganization",
  "isMirror",
  "isPrivate",
  "isSecurityPolicyEnabled",
  "isTemplate",
  "isUserConfigurationRepository",
  "issueTemplates",
  "issues",
  "labels",
  "languages",
  "latestRelease",
  "licenseInfo",
  "mentionableUsers",
  "mergeCommitAllowed",
  "milestones",
  "mirrorUrl",
  "name",
  "nameWithOwner",
  "openGraphImageUrl",
  "owner",
  "parent",
  "primaryLanguage",
  "projects",
  "pullRequestTemplates",
  "pullRequests",
  "pushedAt",
  "rebaseMergeAllowed",
  "repositoryTopics",
  "securityPolicyUrl",
  "squashMergeAllowed",
  "sshUrl",
  "stargazerCount",
  "templateRepository",
  "updatedAt",
  "url",
  "viewerCanAdminister",
  "viewerDefaultCommitEmail",
  "viewerDefaultMergeMethod",
  "viewerHasStarred",
  "viewerPermission",
  "viewerPossibleCommitEmails",
  "viewerSubscription",
  "visibility",
  "watchers",
];

function serializeRepoForJson(repo: GhRepo): Record<string, unknown> {
  return {
    id: `R_${repo.id}`,
    name: repo.name,
    nameWithOwner: repo.nameWithOwner,
    owner: repo.owner,
    description: repo.description,
    homepageUrl: repo.homepageUrl,
    url: repo.url,
    sshUrl: repo.sshUrl,
    visibility: repo.visibility,
    isPrivate: repo.isPrivate,
    isFork: repo.isFork,
    isArchived: repo.isArchived,
    isTemplate: repo.isTemplate,
    isEmpty: false,
    isInOrganization: false,
    isMirror: false,
    isBlankIssuesEnabled: true,
    isSecurityPolicyEnabled: false,
    isUserConfigurationRepository: false,
    defaultBranchRef: repo.defaultBranchRef,
    parent: repo.parent,
    primaryLanguage: repo.primaryLanguage,
    repositoryTopics: repo.repositoryTopics,
    hasIssuesEnabled: repo.hasIssuesEnabled,
    hasWikiEnabled: repo.hasWikiEnabled,
    hasProjectsEnabled: repo.hasProjectsEnabled,
    hasDiscussionsEnabled: repo.hasDiscussionsEnabled,
    mergeCommitAllowed: repo.mergeCommitAllowed,
    squashMergeAllowed: repo.squashMergeAllowed,
    rebaseMergeAllowed: repo.rebaseMergeAllowed,
    deleteBranchOnMerge: repo.deleteBranchOnMerge,
    stargazerCount: repo.stargazerCount,
    forkCount: repo.forkCount,
    viewerPermission: repo.viewerPermission,
    viewerCanAdminister: repo.viewerPermission === "ADMIN",
    viewerDefaultCommitEmail: `${repo.owner.login}@github.com`,
    viewerDefaultMergeMethod: "MERGE",
    viewerHasStarred: false,
    viewerPossibleCommitEmails: [`${repo.owner.login}@github.com`],
    viewerSubscription: "SUBSCRIBED",
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,
    archivedAt: repo.isArchived ? repo.updatedAt : null,
    diskUsage: 128,
    labels: Array.from(repo.labels.values()),
    milestones: Array.from(repo.milestones.values()),
    pullRequests: { totalCount: repo.pullRequests.size },
    issues: { totalCount: repo.issues.size },
    watchers: { totalCount: 1 },
    latestRelease: Array.from(repo.releases.values())[0] ?? null,
    licenseInfo: { key: "mit", name: "MIT License", nickname: "MIT" },
    assignableUsers: [repo.owner],
    mentionableUsers: [repo.owner],
    languages: repo.primaryLanguage ? [{ size: 1024, node: repo.primaryLanguage }] : [],
    codeOfConduct: null,
    contactLinks: [],
    fundingLinks: [],
    issueTemplates: [],
    pullRequestTemplates: [],
    projects: [],
    mirrorUrl: null,
    openGraphImageUrl: `${repo.url}/opengraph.png`,
    securityPolicyUrl: null,
    templateRepository: null,
  };
}

function extractBranchFromGitFlags(gitFlags: readonly string[]): string | undefined {
  for (let i = 0; i < gitFlags.length; i++) {
    const arg = gitFlags[i]!;
    if ((arg === "-b" || arg === "--branch") && gitFlags[i + 1]) {
      return gitFlags[i + 1]!;
    }
    if (arg.startsWith("--branch=")) {
      return arg.slice("--branch=".length);
    }
  }
  return undefined;
}

export async function cloneRepositoryIntoVfs(options: {
  readonly context: CommandContext;
  readonly repo: GhRepo;
  readonly targetDir: string;
  readonly branch?: string | undefined;
  readonly upstreamRemoteName?: string | undefined;
  readonly useSsh?: boolean | undefined;
  readonly ssh?: GhSshProvider | undefined;
  readonly git?: CommandDefinition | CommandHandler | undefined;
}): Promise<void> {
  const { context, repo, targetDir, branch, upstreamRemoteName = "upstream", useSsh, ssh, git } = options;
  if (useSsh && ssh) {
    await ssh.connect("github.com", "git", `git-upload-pack '${repo.nameWithOwner}.git'`);
  }

  const branchToCheckout = branch ?? repo.defaultBranchRef.name;
  const files =
    repo.branchFiles.get(branchToCheckout) ??
    repo.branchFiles.get(repo.defaultBranchRef.name) ?? {
      "README.md": `# ${repo.name}\n`,
    };

  await context.fs.mkdir(targetDir, { recursive: true, signal: context.signal });
  await runGitInVfs(context, ["init", "-b", branchToCheckout], { cwd: targetDir, git });
  await writeWorktreeFiles(context.fs, targetDir, files, context.signal, false);
  await runGitInVfs(context, ["add", "."], { cwd: targetDir, git });
  await runGitInVfs(
    context,
    ["commit", "--allow-empty", "-m", `Clone ${repo.nameWithOwner}`],
    { cwd: targetDir, git }
  );

  // Materialize additional branches from repo in local .git
  for (const [bName, bFiles] of repo.branchFiles.entries()) {
    if (bName === branchToCheckout) continue;
    await runGitInVfs(context, ["checkout", "-B", bName], { cwd: targetDir, git });
    await writeWorktreeFiles(context.fs, targetDir, bFiles, context.signal, true);
    await runGitInVfs(context, ["add", "."], { cwd: targetDir, git });
    await runGitInVfs(context, ["commit", "--allow-empty", "-m", `Branch ${bName}`], { cwd: targetDir, git });
  }
  if (repo.branchFiles.size > 1) {
    await runGitInVfs(context, ["checkout", branchToCheckout], { cwd: targetDir, git });
    await writeWorktreeFiles(context.fs, targetDir, files, context.signal, true);
  }

  const originUrl = useSsh ? repo.sshUrl : repo.cloneUrl;
  if (repo.isFork && repo.parent) {
    await updateGitRemote(context.fs, targetDir, "origin", originUrl, undefined, context.signal);
    const parentUrl = useSsh
      ? `git@github.com:${repo.parent.nameWithOwner}.git`
      : `https://github.com/${repo.parent.nameWithOwner}.git`;
    await updateGitRemote(
      context.fs,
      targetDir,
      upstreamRemoteName,
      parentUrl,
      "base",
      context.signal
    );
  } else {
    await updateGitRemote(context.fs, targetDir, "origin", originUrl, "base", context.signal);
  }
}

export interface RepoHandlerEnv {
  readonly context: CommandContext;
  readonly backend: GitHubBackend;
  readonly http?: GhHttpTransport | undefined;
  readonly git?: CommandDefinition | CommandHandler | undefined;
  readonly ssh?: GhSshProvider | undefined;
  readonly openBrowser?: GhBrowserOpener | undefined;
  readonly limits: GhLimits;
  readonly writeOut: (text: string) => Promise<void>;
  readonly writeErr: (text: string) => Promise<void>;
}

export async function handleRepoCommand(
  env: RepoHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, git, ssh, openBrowser, limits, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  const restArgs = rawArgs.slice(1);

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut(
      [
        "Work with GitHub repositories.",
        "",
        "USAGE",
        "  gh repo <command> [flags]",
        "",
        "GENERAL COMMANDS",
        "  create:      Create a new repository",
        "  list (ls):   List repositories owned by user or organization",
        "",
        "TARGETED COMMANDS",
        "  clone:       Clone a repository locally",
        "  fork:        Create a fork of a repository",
        "  view:        View a repository",
        "  sync:        Sync a repository",
        "  set-default: Configure default repository for this directory",
        "  edit:        Edit repository settings",
        "  delete:      Delete a repository",
        "  archive:     Archive a repository",
        "  unarchive:   Unarchive a repository",
        "  rename:      Rename a repository",
        "  deploy-key:  Manage deploy keys in a repository",
        "  credits:     View credits for a repository",
        "  gitignore:   List and view available repository gitignore templates",
        "  license:     Explore repository licenses",
        "",
      ].join("\n")
    );
    return 0;
  }

  // 1. gh repo clone
  if (subcommand === "clone") {
    const schemas: FlagSchema[] = [{ short: "u", long: "upstream-remote-name", type: "string" }];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh repo clone <repository> [<directory>] [-- <gitflags>...]\n");
      return 0;
    }
    const repoArg = parsed.positionals[0];
    if (!repoArg) {
      await writeErr("cannot clone: repository argument required\n");
      return 1;
    }
    const coords = parseRepoSpec(repoArg, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);

    if (env.http) {
      await backend.dispatchHttp(
        {
          url: `https://api.github.com/repos/${repo.owner.login}/${repo.name}`,
          method: "GET",
          headers: { accept: "application/vnd.github+json" },
          body: new Uint8Array(),
          signal: context.signal,
        },
        env.http,
        limits
      );
    }

    const dirArg = parsed.positionals[1] ?? repo.name;
    const targetDir = resolvePath(context.cwd, dirArg);
    const branchFlag = extractBranchFromGitFlags(parsed.passthrough);
    const upstreamRemoteName = getStringFlag(parsed, "upstream-remote-name") ?? "upstream";
    const useSsh =
      repoArg.startsWith("git@") ||
      repoArg.startsWith("ssh://") ||
      backend.config.gitProtocol === "ssh";

    await cloneRepositoryIntoVfs({
      context,
      repo,
      targetDir,
      branch: branchFlag,
      upstreamRemoteName,
      useSsh,
      ssh,
      git,
    });

    await writeOut(`Cloning into '${dirArg}'...\n`);
    return 0;
  }

  // 2. gh repo create
  if (subcommand === "create" || subcommand === "new") {
    const schemas: FlagSchema[] = [
      { long: "public", type: "boolean" },
      { long: "private", type: "boolean" },
      { long: "internal", type: "boolean" },
      { short: "d", long: "description", type: "string" },
      { short: "h", long: "homepage", type: "string" },
      { short: "s", long: "source", type: "string" },
      { short: "r", long: "remote", type: "string" },
      { long: "push", type: "boolean" },
      { short: "c", long: "clone", type: "boolean" },
      { short: "p", long: "template", type: "string" },
      { long: "add-readme", type: "boolean" },
      { short: "g", long: "gitignore", type: "string" },
      { short: "l", long: "license", type: "string" },
      { long: "disable-issues", type: "boolean" },
      { long: "disable-wiki", type: "boolean" },
      { long: "include-all-branches", type: "boolean" },
      { short: "t", long: "team", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh repo create [<name>] [flags]\n");
      return 0;
    }

    const sourceDirFlag = getStringFlag(parsed, "source");
    const rawName =
      parsed.positionals[0] ??
      (sourceDirFlag ? resolvePath(context.cwd, sourceDirFlag).split("/").filter(Boolean).pop() : undefined) ??
      "new-repo";

    const coords = parseRepoSpec(rawName, backend.defaultHost, backend.getActiveUser());
    if (backend.getRepo(coords.owner, coords.name)) {
      await writeErr(`repository ${coords.nameWithOwner} already exists\n`);
      return 1;
    }

    const visibility: "PUBLIC" | "PRIVATE" | "INTERNAL" = getBoolFlag(parsed, "private")
      ? "PRIVATE"
      : getBoolFlag(parsed, "internal")
        ? "INTERNAL"
        : "PUBLIC";

    const initialFiles: Record<string, string> = {};
    const templateSpec = getStringFlag(parsed, "template");
    if (templateSpec) {
      const tmplCoords = parseRepoSpec(templateSpec, backend.defaultHost, backend.getActiveUser());
      const tmplRepo = backend.getOrCreateRepo(tmplCoords.owner, tmplCoords.name);
      const tmplFiles = tmplRepo.branchFiles.get(tmplRepo.defaultBranchRef.name) ?? {};
      Object.assign(initialFiles, tmplFiles);
    }

    if (sourceDirFlag && getBoolFlag(parsed, "push")) {
      const srcPath = resolvePath(context.cwd, sourceDirFlag);
      const localFiles = await readWorktreeFiles(context.fs, srcPath, context.signal);
      Object.assign(initialFiles, localFiles);
    }

    if (getBoolFlag(parsed, "add-readme") || Object.keys(initialFiles).length === 0) {
      initialFiles["README.md"] = `# ${coords.name}\n\n${getStringFlag(parsed, "description") ?? ""}\n`;
    }
    const gitignoreTmpl = getStringFlag(parsed, "gitignore");
    if (gitignoreTmpl) {
      initialFiles[".gitignore"] = `# ${gitignoreTmpl}\nnode_modules/\ndist/\n.env\n`;
    }
    const licenseTmpl = getStringFlag(parsed, "license");
    if (licenseTmpl) {
      initialFiles["LICENSE"] = `${licenseTmpl.toUpperCase()} License\n\nCopyright (c) ${coords.owner}\n`;
    }

    if (env.http) {
      await backend.dispatchHttp(
        {
          url: "https://api.github.com/user/repos",
          method: "POST",
          headers: { "content-type": "application/json" },
          body: encodeUtf8(
            JSON.stringify({
              name: coords.name,
              private: visibility !== "PUBLIC",
              description: getStringFlag(parsed, "description") ?? "",
              homepage: getStringFlag(parsed, "homepage") ?? "",
            })
          ),
          signal: context.signal,
        },
        env.http,
        limits
      );
    }

    const repo = backend.ensureRepo(coords.owner, coords.name, {
      description: getStringFlag(parsed, "description") ?? "",
      homepageUrl: getStringFlag(parsed, "homepage") ?? "",
      visibility,
      files: initialFiles,
    });
    if (getBoolFlag(parsed, "disable-issues")) repo.hasIssuesEnabled = false;
    if (getBoolFlag(parsed, "disable-wiki")) repo.hasWikiEnabled = false;

    if (sourceDirFlag) {
      const srcPath = resolvePath(context.cwd, sourceDirFlag);
      const remoteName = getStringFlag(parsed, "remote") ?? "origin";
      await updateGitRemote(context.fs, srcPath, remoteName, repo.cloneUrl, "base", context.signal);
      if (getBoolFlag(parsed, "push")) {
        const currentBranch = await readCurrentBranch(context, srcPath, git);
        const worktree = await readWorktreeFiles(context.fs, srcPath, context.signal);
        repo.branchFiles.set(currentBranch, worktree);
      }
    } else if (getBoolFlag(parsed, "clone")) {
      const cloneTarget = resolvePath(context.cwd, repo.name);
      await cloneRepositoryIntoVfs({
        context,
        repo,
        targetDir: cloneTarget,
        useSsh: backend.config.gitProtocol === "ssh",
        ssh,
        git,
      });
    }

    await writeOut(`${repo.url}\n`);
    return 0;
  }

  // 3. gh repo fork
  if (subcommand === "fork") {
    const schemas: FlagSchema[] = [
      { long: "clone", type: "boolean" },
      { long: "remote", type: "boolean" },
      { long: "remote-name", type: "string" },
      { long: "org", type: "string" },
      { long: "fork-name", type: "string" },
      { long: "default-branch-only", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh repo fork [<repository>] [flags]\n");
      return 0;
    }

    const sourceCoords = parsed.positionals[0]
      ? parseRepoSpec(parsed.positionals[0], backend.defaultHost, backend.getActiveUser())
      : await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());

    const sourceRepo = backend.getOrCreateRepo(sourceCoords.owner, sourceCoords.name);
    const targetOwner = getStringFlag(parsed, "org") ?? backend.getActiveUser();
    const forkName = getStringFlag(parsed, "fork-name") ?? sourceRepo.name;

    const defaultFiles = sourceRepo.branchFiles.get(sourceRepo.defaultBranchRef.name) ?? {};
    const forkRepo = backend.ensureRepo(targetOwner, forkName, {
      description: sourceRepo.description,
      visibility: sourceRepo.visibility,
      defaultBranch: sourceRepo.defaultBranchRef.name,
      isFork: true,
      parent: {
        nameWithOwner: sourceRepo.nameWithOwner,
        owner: sourceRepo.owner,
        name: sourceRepo.name,
        defaultBranchRef: sourceRepo.defaultBranchRef,
      },
      files: defaultFiles,
    });
    if (!getBoolFlag(parsed, "default-branch-only")) {
      for (const [bName, bFiles] of sourceRepo.branchFiles.entries()) {
        forkRepo.branchFiles.set(bName, { ...bFiles });
      }
      for (const [bName, oid] of sourceRepo.branches.entries()) {
        forkRepo.branches.set(bName, oid);
      }
    }
    sourceRepo.forkCount += 1;

    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    if (getBoolFlag(parsed, "remote") && gitRoot) {
      const remoteName = getStringFlag(parsed, "remote-name") ?? "origin";
      await updateGitRemote(context.fs, gitRoot, remoteName, forkRepo.cloneUrl, undefined, context.signal);
      await updateGitRemote(context.fs, gitRoot, "upstream", sourceRepo.cloneUrl, "base", context.signal);
    }

    if (getBoolFlag(parsed, "clone")) {
      const targetDir = resolvePath(context.cwd, forkRepo.name);
      await cloneRepositoryIntoVfs({
        context,
        repo: forkRepo,
        targetDir,
        useSsh: backend.config.gitProtocol === "ssh",
        ssh,
        git,
      });
    }

    await writeOut(`${forkRepo.url}\n`);
    return 0;
  }

  // 4. gh repo view
  if (subcommand === "view") {
    const schemas: FlagSchema[] = [{ short: "b", long: "branch", type: "string" }];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh repo view [<repository>] [flags]\n");
      return 0;
    }

    const coords = parsed.positionals[0]
      ? parseRepoSpec(parsed.positionals[0], backend.defaultHost, backend.getActiveUser())
      : await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);

    if (getBoolFlag(parsed, "web")) {
      if (openBrowser) await openBrowser(repo.url);
      await writeOut(`Opening ${repo.url} in your browser.\n`);
      return 0;
    }

    const formatted = await formatCommandOutput({
      data: serializeRepoForJson(repo),
      availableFields: REPO_JSON_FIELDS,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }

    const branch = getStringFlag(parsed, "branch") ?? repo.defaultBranchRef.name;
    const files = repo.branchFiles.get(branch) ?? repo.branchFiles.get(repo.defaultBranchRef.name) ?? {};
    const readme =
      files["README.md"] ??
      files["readme.md"] ??
      files["README"] ??
      "No README provided.";

    await writeOut(
      [
        `${repo.nameWithOwner}`,
        repo.description || "No description provided",
        "",
        readme.trim(),
        "",
        `View this repository on GitHub: ${repo.url}`,
        "",
      ].join("\n")
    );
    return 0;
  }

  // 5. gh repo list / ls
  if (subcommand === "list" || subcommand === "ls") {
    const schemas: FlagSchema[] = [
      { short: "L", long: "limit", type: "string" },
      { long: "public", type: "boolean" },
      { long: "private", type: "boolean" },
      { long: "internal", type: "boolean" },
      { long: "fork", type: "boolean" },
      { long: "source", type: "boolean" },
      { long: "archived", type: "boolean" },
      { long: "no-archived", type: "boolean" },
      { short: "l", long: "language", type: "string" },
      { long: "topic", type: "string[]" },
      { long: "visibility", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh repo list [<owner>] [flags]\n");
      return 0;
    }

    const ownerFilter = parsed.positionals[0]?.toLowerCase();
    const limit = Math.min(getIntFlag(parsed, "limit", 30), limits.maxItems);
    const visFlag = getStringFlag(parsed, "visibility")?.toUpperCase();
    const langFlag = getStringFlag(parsed, "language")?.toLowerCase();
    const topicFlags = getStringArrayFlag(parsed, "topic").map((t) => t.toLowerCase());

    let repos = Array.from(backend.repos.values());
    repos = repos.filter((r) => {
      if (ownerFilter && r.owner.login.toLowerCase() !== ownerFilter) return false;
      if (getBoolFlag(parsed, "public") && r.visibility !== "PUBLIC") return false;
      if (getBoolFlag(parsed, "private") && r.visibility !== "PRIVATE") return false;
      if (getBoolFlag(parsed, "internal") && r.visibility !== "INTERNAL") return false;
      if (visFlag && r.visibility !== visFlag) return false;
      if (getBoolFlag(parsed, "fork") && !r.isFork) return false;
      if (getBoolFlag(parsed, "source") && r.isFork) return false;
      if (getBoolFlag(parsed, "archived") && !r.isArchived) return false;
      if (getBoolFlag(parsed, "no-archived") && r.isArchived) return false;
      if (langFlag && r.primaryLanguage?.name.toLowerCase() !== langFlag) return false;
      for (const topic of topicFlags) {
        if (!r.repositoryTopics.some((t) => t.name.toLowerCase() === topic)) return false;
      }
      return true;
    });

    repos = repos.slice(0, limit);

    const formatted = await formatCommandOutput({
      data: repos.map((r) => serializeRepoForJson(r)),
      availableFields: REPO_JSON_FIELDS,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
      return 0;
    }

    const lines = repos.map((r) => {
      const info = [
        r.visibility.toLowerCase(),
        ...(r.isFork ? ["fork"] : []),
        ...(r.isArchived ? ["archived"] : []),
      ].join(", ");
      return `${r.nameWithOwner}\t${r.description}\t${info}\t${r.pushedAt}`;
    });
    await writeOut(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    return 0;
  }

  // 6. gh repo sync
  if (subcommand === "sync") {
    const schemas: FlagSchema[] = [
      { short: "b", long: "branch", type: "string" },
      { short: "s", long: "source", type: "string" },
      { long: "force", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh repo sync [<destination-repository>] [flags]\n");
      return 0;
    }

    const destArg = parsed.positionals[0];
    if (destArg) {
      const destCoords = parseRepoSpec(destArg, backend.defaultHost, backend.getActiveUser());
      const destRepo = backend.getOrCreateRepo(destCoords.owner, destCoords.name);
      const srcSpec = getStringFlag(parsed, "source") ?? destRepo.parent?.nameWithOwner;
      if (!srcSpec) {
        await writeErr(`cannot determine source repository for ${destRepo.nameWithOwner}; specify --source\n`);
        return 1;
      }
      const srcCoords = parseRepoSpec(srcSpec, backend.defaultHost, backend.getActiveUser());
      const srcRepo = backend.getOrCreateRepo(srcCoords.owner, srcCoords.name);
      const branch = getStringFlag(parsed, "branch") ?? destRepo.defaultBranchRef.name;
      const srcFiles = srcRepo.branchFiles.get(branch) ?? srcRepo.branchFiles.get(srcRepo.defaultBranchRef.name) ?? {};
      const srcOid = srcRepo.branches.get(branch) ?? srcRepo.branches.get(srcRepo.defaultBranchRef.name) ?? "";
      destRepo.branchFiles.set(branch, { ...srcFiles });
      if (srcOid) destRepo.branches.set(branch, srcOid);
      await writeOut(`✓ Synced the "${destRepo.nameWithOwner}:${branch}" branch from "${srcRepo.nameWithOwner}:${branch}"\n`);
      return 0;
    }

    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    if (!gitRoot) {
      await writeErr("not in a git repository and no destination repository specified\n");
      return 1;
    }
    const coords = await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const branch = getStringFlag(parsed, "branch") ?? (await readCurrentBranch(context, gitRoot, git));
    const files = repo.branchFiles.get(branch) ?? repo.branchFiles.get(repo.defaultBranchRef.name) ?? {};
    await writeWorktreeFiles(context.fs, gitRoot, files, context.signal, true);
    await runGitInVfs(context, ["add", "."], { cwd: gitRoot, git });
    await runGitInVfs(context, ["commit", "--allow-empty", "-m", `Sync ${branch}`], { cwd: gitRoot, git });
    await writeOut(`✓ Synced the "${branch}" branch from ${repo.nameWithOwner} to local repository\n`);
    return 0;
  }

  // 7. gh repo set-default
  if (subcommand === "set-default") {
    const schemas: FlagSchema[] = [
      { short: "v", long: "view", type: "boolean" },
      { short: "u", long: "unset", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh repo set-default [<repository>] [flags]\n");
      return 0;
    }

    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    if (!gitRoot) {
      await writeErr("must be run from inside a git repository\n");
      return 1;
    }

    if (getBoolFlag(parsed, "unset")) {
      await setDefaultRepoInGitConfig(context.fs, gitRoot, undefined, context.signal);
      await writeOut("✓ Unset default repository\n");
      return 0;
    }

    if (getBoolFlag(parsed, "view") || parsed.positionals.length === 0) {
      const cfg = await readGitConfig(context.fs, gitRoot, context.signal);
      for (const remote of cfg.remotes.values()) {
        if (remote.ghResolved === "base" && remote.url) {
          const coords = parseRepoSpec(remote.url, backend.defaultHost, backend.getActiveUser());
          await writeOut(`${coords.nameWithOwner}\n`);
          return 0;
        }
        if (remote.ghResolved && remote.ghResolved !== "base") {
          await writeOut(`${remote.ghResolved}\n`);
          return 0;
        }
      }
      await writeOut("no default repository has been set; use `gh repo set-default <repo>`\n");
      return 0;
    }

    const targetCoords = parseRepoSpec(parsed.positionals[0]!, backend.defaultHost, backend.getActiveUser());
    await setDefaultRepoInGitConfig(context.fs, gitRoot, targetCoords.nameWithOwner, context.signal);
    await writeOut(`✓ Set ${targetCoords.nameWithOwner} as the default repository for the current directory\n`);
    return 0;
  }

  // 8. gh repo edit
  if (subcommand === "edit") {
    const schemas: FlagSchema[] = [
      { short: "d", long: "description", type: "string" },
      { short: "h", long: "homepage", type: "string" },
      { long: "default-branch", type: "string" },
      { long: "visibility", type: "string" },
      { long: "enable-issues", type: "boolean" },
      { long: "enable-wiki", type: "boolean" },
      { long: "enable-projects", type: "boolean" },
      { long: "enable-discussions", type: "boolean" },
      { long: "enable-auto-merge", type: "boolean" },
      { long: "enable-merge-commit", type: "boolean" },
      { long: "enable-squash-merge", type: "boolean" },
      { long: "enable-rebase-merge", type: "boolean" },
      { long: "delete-branch-on-merge", type: "boolean" },
      { long: "template", type: "boolean" },
      { long: "add-topic", type: "string[]" },
      { long: "remove-topic", type: "string[]" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh repo edit [<repository>] [flags]\n");
      return 0;
    }
    const coords = parsed.positionals[0]
      ? parseRepoSpec(parsed.positionals[0], backend.defaultHost, backend.getActiveUser())
      : await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);

    const desc = getStringFlag(parsed, "description");
    if (desc !== undefined) repo.description = desc;
    const homepage = getStringFlag(parsed, "homepage");
    if (homepage !== undefined) repo.homepageUrl = homepage;
    const defBranch = getStringFlag(parsed, "default-branch");
    if (defBranch !== undefined) repo.defaultBranchRef = { name: defBranch };
    const vis = getStringFlag(parsed, "visibility")?.toUpperCase();
    if (vis === "PUBLIC" || vis === "PRIVATE" || vis === "INTERNAL") {
      repo.visibility = vis;
      repo.isPrivate = vis !== "PUBLIC";
    }
    if (parsed.flags.has("enable-issues")) repo.hasIssuesEnabled = getBoolFlag(parsed, "enable-issues");
    if (parsed.flags.has("enable-wiki")) repo.hasWikiEnabled = getBoolFlag(parsed, "enable-wiki");
    if (parsed.flags.has("enable-projects")) repo.hasProjectsEnabled = getBoolFlag(parsed, "enable-projects");
    if (parsed.flags.has("enable-discussions")) repo.hasDiscussionsEnabled = getBoolFlag(parsed, "enable-discussions");
    if (parsed.flags.has("enable-auto-merge")) repo.autoMergeAllowed = getBoolFlag(parsed, "enable-auto-merge");
    if (parsed.flags.has("enable-merge-commit")) repo.mergeCommitAllowed = getBoolFlag(parsed, "enable-merge-commit");
    if (parsed.flags.has("enable-squash-merge")) repo.squashMergeAllowed = getBoolFlag(parsed, "enable-squash-merge");
    if (parsed.flags.has("enable-rebase-merge")) repo.rebaseMergeAllowed = getBoolFlag(parsed, "enable-rebase-merge");
    if (parsed.flags.has("delete-branch-on-merge"))
      repo.deleteBranchOnMerge = getBoolFlag(parsed, "delete-branch-on-merge");
    if (parsed.flags.has("template")) repo.isTemplate = getBoolFlag(parsed, "template");

    for (const topic of getStringArrayFlag(parsed, "add-topic")) {
      if (!repo.repositoryTopics.some((t) => t.name.toLowerCase() === topic.toLowerCase())) {
        repo.repositoryTopics.push({ name: topic });
      }
    }
    const rmTopics = getStringArrayFlag(parsed, "remove-topic").map((t) => t.toLowerCase());
    if (rmTopics.length > 0) {
      repo.repositoryTopics = repo.repositoryTopics.filter((t) => !rmTopics.includes(t.name.toLowerCase()));
    }

    await writeOut(`✓ Edited repository ${repo.nameWithOwner}\n`);
    return 0;
  }

  // 9. gh repo delete
  if (subcommand === "delete") {
    const parsed = parseCommandArgs(restArgs, []);
    if (parsed.help) {
      await writeOut("Usage: gh repo delete [<repository>] [--yes]\n");
      return 0;
    }
    const coords = parsed.positionals[0]
      ? parseRepoSpec(parsed.positionals[0], backend.defaultHost, backend.getActiveUser())
      : await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
    backend.repos.delete(coords.nameWithOwner.toLowerCase());
    await writeOut(`✓ Deleted repository ${coords.nameWithOwner}\n`);
    return 0;
  }

  // 10. gh repo archive / unarchive
  if (subcommand === "archive" || subcommand === "unarchive") {
    const parsed = parseCommandArgs(restArgs, []);
    const coords = parsed.positionals[0]
      ? parseRepoSpec(parsed.positionals[0], backend.defaultHost, backend.getActiveUser())
      : await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    repo.isArchived = subcommand === "archive";
    await writeOut(
      `✓ ${subcommand === "archive" ? "Archived" : "Unarchived"} repository ${repo.nameWithOwner}\n`
    );
    return 0;
  }

  // 11. gh repo rename
  if (subcommand === "rename") {
    const parsed = parseCommandArgs(restArgs, []);
    const newName = parsed.positionals[0];
    if (!newName) {
      await writeErr("new repository name required\n");
      return 1;
    }
    const coords = await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    backend.repos.delete(repo.nameWithOwner.toLowerCase());
    repo.name = newName;
    repo.nameWithOwner = `${repo.owner.login}/${newName}`;
    repo.url = `https://${backend.defaultHost}/${repo.nameWithOwner}`;
    repo.cloneUrl = `https://${backend.defaultHost}/${repo.nameWithOwner}.git`;
    repo.sshUrl = `git@${backend.defaultHost}:${repo.nameWithOwner}.git`;
    backend.repos.set(repo.nameWithOwner.toLowerCase(), repo);
    await writeOut(`✓ Renamed repository to ${repo.nameWithOwner}\n`);
    return 0;
  }

  // 12. gh repo deploy-key
  if (subcommand === "deploy-key") {
    const action = restArgs[0] ?? "list";
    const subRest = restArgs.slice(1);
    const schemas: FlagSchema[] = [
      { short: "t", long: "title", type: "string" },
      { short: "w", long: "allow-write", type: "boolean" },
    ];
    const parsed = parseCommandArgs(subRest, schemas);
    const coords = await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);

    if (action === "list" || action === "ls") {
      const keys = Array.from(repo.deployKeys.values());
      const formatted = await formatCommandOutput({
        data: keys,
        availableFields: ["id", "title", "key", "readOnly", "createdAt"],
        jsonFlag: getStringFlag(parsed, "json"),
        jqFlag: getStringFlag(parsed, "jq"),
        templateFlag: getStringFlag(parsed, "template"),
        signal: context.signal,
      });
      if (formatted !== undefined) {
        await writeOut(formatted);
        return 0;
      }
      const lines = keys.map(
        (k) => `${k.id}\t${k.title}\t${k.readOnly ? "read-only" : "read-write"}\t${k.key}\t${k.createdAt}`
      );
      await writeOut(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
      return 0;
    }

    if (action === "add") {
      const keyFile = parsed.positionals[0];
      if (!keyFile) {
        await writeErr("deploy key file required\n");
        return 1;
      }
      const keyContent = decodeUtf8(
        await context.fs.readFile(resolvePath(context.cwd, keyFile), { signal: context.signal })
      ).trim();
      if (ssh) {
        await ssh.fingerprint(keyContent);
      }
      const id = backend.nextId();
      const dk: GhDeployKey = {
        id,
        title: getStringFlag(parsed, "title") ?? keyFile,
        key: keyContent,
        readOnly: !getBoolFlag(parsed, "allow-write"),
        createdAt: backend.isoNow(),
      };
      repo.deployKeys.set(id, dk);
      await writeOut(`✓ Deploy key added to ${repo.nameWithOwner}\n`);
      return 0;
    }

    if (action === "delete") {
      const keyId = Number(parsed.positionals[0]);
      repo.deployKeys.delete(keyId);
      await writeOut(`✓ Deploy key ${keyId} deleted from ${repo.nameWithOwner}\n`);
      return 0;
    }
  }

  if (subcommand === "credits") {
    await writeOut("Contributors: octocat\n");
    return 0;
  }

  if (subcommand === "gitignore") {
    const action = restArgs[0] ?? "list";
    if (action === "list") {
      await writeOut("Node\nPython\nRust\nGo\nTypeScript\n");
      return 0;
    }
    const tmpl = restArgs[1] ?? "Node";
    await writeOut(`# ${tmpl}\nnode_modules/\ndist/\n.env\n`);
    return 0;
  }

  if (subcommand === "license") {
    const action = restArgs[0] ?? "list";
    if (action === "list") {
      await writeOut("mit\tMIT License\napache-2.0\tApache License 2.0\ngpl-3.0\tGNU General Public License v3.0\n");
      return 0;
    }
    const lic = restArgs[1] ?? "mit";
    await writeOut(`${lic.toUpperCase()} License\n\nPermission is hereby granted, free of charge...\n`);
    return 0;
  }

  if (subcommand === "autolink") {
    const action = restArgs[0] ?? "list";
    const subRest = restArgs.slice(1);
    const schemas: FlagSchema[] = [
      { short: "n", long: "numeric", type: "boolean" },
      { long: "json", type: "string" },
      { short: "q", long: "jq", type: "string" },
      { short: "t", long: "template", type: "string" },
    ];
    const parsed = parseCommandArgs(subRest, schemas);
    const coords = await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    repo.autolinks ??= new Map();

    if (action === "list") {
      const list = [...repo.autolinks.values()];
      if (parsed.flags.has("json")) {
        const out = await formatCommandOutput({ data: list, availableFields: ["id", "keyPrefix", "urlTemplate", "isAlphanumeric"], jsonFlag: getStringFlag(parsed, "json"), jqFlag: getStringFlag(parsed, "jq"), templateFlag: getStringFlag(parsed, "template"), signal: context.signal });
        await writeOut(out ?? "");
        return 0;
      }
      for (const item of list) {
        await writeOut(`${item.id}\t${item.keyPrefix}\t${item.urlTemplate}\t${item.isAlphanumeric}\n`);
      }
      return 0;
    }
    if (action === "create") {
      const keyPrefix = parsed.positionals[0] ?? "TICKET-";
      const urlTemplate = parsed.positionals[1] ?? "https://example.com/ticket/<num>";
      const id = backend.nextId();
      const item = {
        id,
        keyPrefix,
        urlTemplate,
        isAlphanumeric: !getBoolFlag(parsed, "numeric"),
      };
      repo.autolinks.set(id, item);
      await writeOut(`✓ Created autolink ${id} for ${repo.nameWithOwner}\n`);
      return 0;
    }
    if (action === "view") {
      const id = Number(parsed.positionals[0]);
      const item = repo.autolinks.get(id);
      if (!item) {
        await writeErr(`autolink ${id} not found\n`);
        return 1;
      }
      if (parsed.flags.has("json")) {
        const out = await formatCommandOutput({ data: item, availableFields: ["id", "keyPrefix", "urlTemplate", "isAlphanumeric"], jsonFlag: getStringFlag(parsed, "json"), jqFlag: getStringFlag(parsed, "jq"), templateFlag: getStringFlag(parsed, "template"), signal: context.signal });
        await writeOut(out ?? "");
        return 0;
      }
      await writeOut(`ID: ${item.id}\nKey Prefix: ${item.keyPrefix}\nURL Template: ${item.urlTemplate}\nAlphanumeric: ${item.isAlphanumeric}\n`);
      return 0;
    }
    if (action === "delete") {
      const id = Number(parsed.positionals[0]);
      repo.autolinks.delete(id);
      await writeOut(`✓ Deleted autolink ${id} from ${repo.nameWithOwner}\n`);
      return 0;
    }
  }

  await writeErr(`unknown command "${subcommand}" for "gh repo"\n`);
  return 1;
}
