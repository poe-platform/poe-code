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
import { bytesToHex, decodeUtf8, encodeUtf8, sha1Sync } from "../crypto-ssh.js";
import {
  computeDiffBetweenFileMaps,
  findGitRoot,
  inspectLocalCommitsForPr,
  pathExists,
  readCurrentBranch,
  readWorktreeFiles,
  resolveRepoFromContext,
  runGitInVfs,
  writeWorktreeFiles,
} from "../git-vfs.js";
import { formatCommandOutput } from "../template.js";
import type {
  GhBrowserOpener,
  GhComment,
  GhHttpTransport,
  GhLabel,
  GhLimits,
  GhPrReview,
  GhPullRequest,
} from "../types.js";

export const PR_JSON_FIELDS: readonly string[] = [
  "additions",
  "assignees",
  "author",
  "autoMergeRequest",
  "baseRefName",
  "baseRefOid",
  "body",
  "changedFiles",
  "closed",
  "closedAt",
  "comments",
  "commits",
  "createdAt",
  "deletions",
  "files",
  "headRefName",
  "headRefOid",
  "headRepository",
  "headRepositoryOwner",
  "id",
  "isCrossRepository",
  "isDraft",
  "labels",
  "latestReviews",
  "locked",
  "maintainerCanModify",
  "mergeCommit",
  "mergeStateStatus",
  "mergeable",
  "mergedAt",
  "mergedBy",
  "milestone",
  "number",
  "potentialMergeCommit",
  "projectCards",
  "projectItems",
  "reactionGroups",
  "reviewDecision",
  "reviewRequests",
  "reviews",
  "state",
  "statusCheckRollup",
  "title",
  "updatedAt",
  "url",
];

export const CHECK_JSON_FIELDS: readonly string[] = [
  "bucket",
  "completedAt",
  "description",
  "event",
  "link",
  "name",
  "startedAt",
  "state",
  "workflow",
];

function serializePrForJson(pr: GhPullRequest): Record<string, unknown> {
  return {
    ...pr,
    id: `PR_${pr.number}`,
    closed: pr.state === "CLOSED" || pr.state === "MERGED",
    isCrossRepository:
      pr.headRepositoryOwner.login.toLowerCase() !==
      (pr.url.split("/")[3] ?? "").toLowerCase(),
    latestReviews: pr.reviews,
    potentialMergeCommit: pr.mergeCommit ?? { oid: bytesToHex(sha1Sync(`potential:${pr.headRefOid}`)) },
    projectCards: [],
    reactionGroups: [],
  };
}

async function readBodyFromFlagOrFile(
  context: CommandContext,
  bodyFlag: string | undefined,
  bodyFileFlag: string | undefined,
  stdinText: string
): Promise<string | undefined> {
  if (bodyFileFlag !== undefined) {
    if (bodyFileFlag === "-") {
      return stdinText;
    }
    const resolved = resolvePath(context.cwd, bodyFileFlag);
    const bytes = await context.fs.readFile(resolved, { signal: context.signal });
    return decodeUtf8(bytes);
  }
  return bodyFlag;
}

function extractRepoAndSelectorFromPrArg(
  selector: string | undefined,
  explicitRepoFlag: string | undefined
): { readonly repoOverride: string | undefined; readonly selector: string | undefined } {
  if (selector && /^https?:\/\/[^/]+\/([^/]+)\/([^/]+)\/pull\/(\d+)/u.test(selector)) {
    const m = /^https?:\/\/([^/]+)\/([^/]+)\/([^/]+)\/pull\/(\d+)/u.exec(selector)!;
    return {
      repoOverride: explicitRepoFlag ?? `${m[1]}/${m[2]}/${m[3]}`,
      selector: m[4]!,
    };
  }
  return { repoOverride: explicitRepoFlag, selector };
}

export interface PrHandlerEnv {
  readonly context: CommandContext;
  readonly backend: GitHubBackend;
  readonly http?: GhHttpTransport | undefined;
  readonly git?: CommandDefinition | CommandHandler | undefined;
  readonly openBrowser?: GhBrowserOpener | undefined;
  readonly limits: GhLimits;
  readonly stdinText: string;
  readonly writeOut: (text: string) => Promise<void>;
  readonly writeErr: (text: string) => Promise<void>;
}

export async function handlePrCommand(
  env: PrHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, git, openBrowser, limits, stdinText, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  const restArgs = rawArgs.slice(1);

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut(
      [
        "Work with GitHub pull requests.",
        "",
        "USAGE",
        "  gh pr <command> [flags]",
        "",
        "GENERAL COMMANDS",
        "  create:        Create a pull request",
        "  list (ls):     List pull requests in a repository",
        "  status:        Show status of relevant pull requests",
        "",
        "TARGETED COMMANDS",
        "  view:          View a pull request",
        "  checkout (co): Check out a pull request in git",
        "  diff:          View changes in a pull request",
        "  checks:        Show CI status for a single pull request",
        "  review:        Add a review to a pull request",
        "  merge:         Merge a pull request",
        "  update-branch: Update a pull request branch",
        "  ready:         Mark a pull request as ready for review",
        "  comment:       Add a comment to a pull request",
        "  close:         Close a pull request",
        "  reopen:        Reopen a pull request",
        "  edit:          Edit a pull request",
        "  lock:          Lock pull request conversation",
        "  unlock:        Unlock pull request conversation",
        "  revert:        Revert a pull request",
        "",
      ].join("\n")
    );
    return 0;
  }

  // 1. gh pr create
  if (subcommand === "create" || subcommand === "new") {
    const schemas: FlagSchema[] = [
      { short: "t", long: "title", type: "string" },
      { short: "b", long: "body", type: "string" },
      { short: "F", long: "body-file", type: "string" },
      { short: "B", long: "base", type: "string" },
      { short: "H", long: "head", type: "string" },
      { short: "d", long: "draft", type: "boolean" },
      { short: "f", long: "fill", type: "boolean" },
      { long: "fill-first", type: "boolean" },
      { long: "fill-verbose", type: "boolean" },
      { short: "l", long: "label", type: "string[]" },
      { short: "a", long: "assignee", type: "string[]" },
      { short: "r", long: "reviewer", type: "string[]" },
      { short: "m", long: "milestone", type: "string" },
      { short: "p", long: "project", type: "string" },
      { short: "T", long: "template", type: "string" },
      { long: "no-maintainer-edit", type: "boolean" },
      { long: "recover", type: "string" },
      { long: "dry-run", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr create [flags]\n");
      return 0;
    }

    const coords = await resolveRepoFromContext(
      context,
      parsed.repoFlag,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : "feature";

    const rawHead = getStringFlag(parsed, "head") ?? currentBranch;
    const headOwner = rawHead.includes(":") ? rawHead.split(":")[0]! : repo.owner.login;
    const headBranch = rawHead.includes(":") ? rawHead.split(":")[1]! : rawHead;
    const baseBranch = getStringFlag(parsed, "base") ?? repo.defaultBranchRef.name;

    if (headBranch === baseBranch && headOwner.toLowerCase() === repo.owner.login.toLowerCase()) {
      await writeErr(
        `must be on a branch named differently than "${baseBranch}"\n`
      );
      return 1;
    }

    if (getBoolFlag(parsed, "web")) {
      const compareUrl = `${repo.url}/compare/${baseBranch}...${headBranch}?expand=1`;
      if (openBrowser) await openBrowser(compareUrl);
      await writeOut(`Opening ${compareUrl} in your browser.\n`);
      return 0;
    }

    // Check duplicate open PR
    const existingOpen = Array.from(repo.pullRequests.values()).find(
      (p) =>
        p.state === "OPEN" &&
        p.headRefName === headBranch &&
        p.baseRefName === baseBranch &&
        p.headRepositoryOwner.login.toLowerCase() === headOwner.toLowerCase()
    );
    if (existingOpen) {
      await writeErr(
        `a pull request for branch "${headBranch}" into branch "${baseBranch}" already exists:\n${existingOpen.url}\n`
      );
      return 1;
    }

    const fill = getBoolFlag(parsed, "fill");
    const fillFirst = getBoolFlag(parsed, "fill-first");
    const fillVerbose = getBoolFlag(parsed, "fill-verbose");

    const localCommits = gitRoot
      ? await inspectLocalCommitsForPr(context, gitRoot, baseBranch, headBranch, git)
      : [];
    const localFiles = gitRoot
      ? await readWorktreeFiles(context.fs, gitRoot, context.signal)
      : undefined;

    let title = getStringFlag(parsed, "title");
    let body = await readBodyFromFlagOrFile(
      context,
      getStringFlag(parsed, "body"),
      getStringFlag(parsed, "body-file"),
      stdinText
    );

    if (parsed.flags.has("recover")) {
      const recoverFile = getStringFlag(parsed, "recover")!;
      const recoverContent = decodeUtf8(
        await context.fs.readFile(resolvePath(context.cwd, recoverFile), { signal: context.signal })
      );
      const lines = recoverContent.split(/\r?\n/u);
      if (!title && lines[0]) title = lines[0];
      if (body === undefined) body = lines.slice(1).join("\n").trim();
    }

    if (!title) {
      if ((fill || fillFirst || fillVerbose) && localCommits.length > 0) {
        const chosen = fillFirst ? localCommits[0]! : localCommits[localCommits.length - 1]!;
        title = chosen.messageHeadline;
      } else {
        title = headBranch
          .replace(/^[-_/]+|[-_/]+$/gu, "")
          .replace(/[-_/]+/gu, " ")
          .replace(/^\w/u, (c) => c.toUpperCase());
      }
    }

    if (body === undefined) {
      const templateFile = getStringFlag(parsed, "template");
      if (templateFile && gitRoot) {
        const candidatePaths = [
          resolvePath(gitRoot, templateFile),
          resolvePath(gitRoot, `.github/PULL_REQUEST_TEMPLATE/${templateFile}`),
          resolvePath(gitRoot, `.github/${templateFile}`),
        ];
        for (const p of candidatePaths) {
          if (await pathExists(context.fs, p, context.signal)) {
            body = decodeUtf8(await context.fs.readFile(p, { signal: context.signal }));
            break;
          }
        }
      }
      if (body === undefined) {
        if (fillVerbose && localCommits.length > 0) {
          body = localCommits
            .map((c) => `- ${c.messageHeadline}${c.messageBody ? `\n\n  ${c.messageBody}` : ""}`)
            .join("\n");
        } else if ((fill || fillFirst) && localCommits.length > 0) {
          const chosen = fillFirst ? localCommits[0]! : localCommits[localCommits.length - 1]!;
          body = chosen.messageBody;
        } else if (gitRoot) {
          const defaultTmpl = `${gitRoot === "/" ? "" : gitRoot}/.github/pull_request_template.md`;
          if (await pathExists(context.fs, defaultTmpl, context.signal)) {
            body = decodeUtf8(await context.fs.readFile(defaultTmpl, { signal: context.signal }));
          }
        }
      }
    }

    const isDraft = getBoolFlag(parsed, "draft");
    const labels = getStringArrayFlag(parsed, "label");
    const assignees = getStringArrayFlag(parsed, "assignee");
    const reviewers = getStringArrayFlag(parsed, "reviewer");
    const milestone = getStringFlag(parsed, "milestone");
    const project = getStringFlag(parsed, "project");
    const maintainerCanModify = !getBoolFlag(parsed, "no-maintainer-edit");

    if (getBoolFlag(parsed, "dry-run")) {
      await writeOut(
        [
          `Would have created a Pull Request in ${repo.nameWithOwner}:`,
          `Title: ${title}`,
          `Draft: ${isDraft}`,
          `Base: ${baseBranch}`,
          `Head: ${headBranch}`,
          ...(labels.length > 0 ? [`Labels: ${labels.join(", ")}`] : []),
          ...(reviewers.length > 0 ? [`Reviewers: ${reviewers.join(", ")}`] : []),
          `Body:\n${body ?? ""}`,
          "",
        ].join("\n")
      );
      return 0;
    }

    if (env.http) {
      await backend.dispatchHttp(
        {
          url: `https://api.github.com/repos/${repo.owner.login}/${repo.name}/pulls`,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: encodeUtf8(
            JSON.stringify({
              title,
              body: body ?? "",
              head: headBranch,
              base: baseBranch,
              draft: isDraft,
            })
          ),
          signal: context.signal,
        },
        env.http,
        limits
      );
    }

    const created = backend.createPullRequest(repo, {
      title,
      body: body ?? "",
      headRefName: headBranch,
      baseRefName: baseBranch,
      isDraft,
      labels,
      assignees,
      reviewers,
      milestone,
      project,
      maintainerCanModify,
      headFiles: localFiles,
      commits: localCommits.length > 0 ? localCommits : undefined,
      headOwner,
    });

    await writeOut(`${created.url}\n`);
    return 0;
  }

  // 2. gh pr list / ls
  if (subcommand === "list" || subcommand === "ls") {
    const schemas: FlagSchema[] = [
      { short: "s", long: "state", type: "string" },
      { short: "B", long: "base", type: "string" },
      { short: "H", long: "head", type: "string" },
      { short: "l", long: "label", type: "string[]" },
      { short: "A", long: "author", type: "string" },
      { short: "a", long: "assignee", type: "string" },
      { short: "S", long: "search", type: "string" },
      { short: "d", long: "draft", type: "boolean" },
      { short: "L", long: "limit", type: "string" },
      { long: "app", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr list [flags]\n");
      return 0;
    }

    const coords = await resolveRepoFromContext(
      context,
      parsed.repoFlag,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);

    if (env.http) {
      await backend.dispatchHttp(
        {
          url: `https://api.github.com/repos/${repo.owner.login}/${repo.name}/pulls`,
          method: "GET",
          headers: { accept: "application/vnd.github+json" },
          body: new Uint8Array(),
          signal: context.signal,
        },
        env.http,
        limits
      );
    }

    const stateFilter = (getStringFlag(parsed, "state") ?? "open").toLowerCase();
    const baseFilter = getStringFlag(parsed, "base");
    const headFilter = getStringFlag(parsed, "head");
    const labelFilters = getStringArrayFlag(parsed, "label").map((l) => l.toLowerCase());
    const rawAuthor = getStringFlag(parsed, "author");
    const authorFilter = rawAuthor === "@me" ? backend.getActiveUser() : rawAuthor;
    const rawAssignee = getStringFlag(parsed, "assignee");
    const assigneeFilter = rawAssignee === "@me" ? backend.getActiveUser() : rawAssignee;
    const draftFlag = parsed.flags.has("draft") ? getBoolFlag(parsed, "draft") : undefined;
    const searchFilter = getStringFlag(parsed, "search");
    const limit = Math.min(getIntFlag(parsed, "limit", 30), limits.maxItems);

    let items = Array.from(repo.pullRequests.values()).sort((a, b) => b.number - a.number);
    items = items.filter((pr) => {
      if (!searchFilter) {
        if (stateFilter === "open" && pr.state !== "OPEN") return false;
        if (stateFilter === "closed" && pr.state !== "CLOSED" && pr.state !== "MERGED") return false;
        if (stateFilter === "merged" && pr.state !== "MERGED") return false;
      }
      if (baseFilter && pr.baseRefName !== baseFilter) return false;
      if (headFilter && pr.headRefName !== headFilter) return false;
      if (draftFlag !== undefined && pr.isDraft !== draftFlag) return false;
      if (authorFilter && pr.author.login.toLowerCase() !== authorFilter.toLowerCase()) return false;
      if (
        assigneeFilter &&
        !pr.assignees.some((a) => a.login.toLowerCase() === assigneeFilter.toLowerCase())
      ) {
        return false;
      }
      for (const lbl of labelFilters) {
        if (!pr.labels.some((l) => l.name.toLowerCase() === lbl)) return false;
      }
      if (searchFilter) {
        for (const token of searchFilter.split(/\s+/u)) {
          if (!token) continue;
          const lower = token.toLowerCase();
          if (lower === "is:open" && pr.state !== "OPEN") return false;
          else if (lower === "is:closed" && pr.state !== "CLOSED" && pr.state !== "MERGED") return false;
          else if (lower === "is:merged" && pr.state !== "MERGED") return false;
          else if (lower === "is:unmerged" && pr.state === "MERGED") return false;
          else if (lower === "is:draft" && !pr.isDraft) return false;
          else if (lower === "-is:draft" && pr.isDraft) return false;
          else if (lower === "review:approved" && pr.reviewDecision !== "APPROVED") return false;
          else if (lower === "review:changes_requested" && pr.reviewDecision !== "CHANGES_REQUESTED")
            return false;
          else if (lower === "review:required" && pr.reviewDecision !== "REVIEW_REQUIRED") return false;
          else if (lower.startsWith("label:")) {
            const targetLbl = lower.slice("label:".length);
            if (!pr.labels.some((l) => l.name.toLowerCase() === targetLbl)) return false;
          } else if (lower.startsWith("author:")) {
            const targetAuthor =
              lower.slice("author:".length) === "@me"
                ? backend.getActiveUser().toLowerCase()
                : lower.slice("author:".length);
            if (pr.author.login.toLowerCase() !== targetAuthor) return false;
          } else if (lower.startsWith("base:")) {
            if (pr.baseRefName.toLowerCase() !== lower.slice("base:".length)) return false;
          } else if (lower.startsWith("head:")) {
            if (pr.headRefName.toLowerCase() !== lower.slice("head:".length)) return false;
          } else if (!lower.includes(":")) {
            const haystack = `${pr.title} ${pr.body}`.toLowerCase();
            if (!haystack.includes(lower)) return false;
          }
        }
      }
      return true;
    });

    items = items.slice(0, limit);

    const formatted = await formatCommandOutput({
      data: items.map((p) => serializePrForJson(p)),
      availableFields: PR_JSON_FIELDS,
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

    if (items.length === 0) {
      await writeOut("");
      return 0;
    }

    const lines = items.map(
      (pr) =>
        `${pr.number}\t${pr.title}\t${pr.headRefName}\t${pr.isDraft ? "DRAFT" : pr.state}`
    );
    await writeOut(lines.join("\n") + "\n");
    return 0;
  }

  // 3. gh pr view
  if (subcommand === "view") {
    const schemas: FlagSchema[] = [{ short: "c", long: "comments", type: "boolean" }];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr view [<number> | <url> | <branch>] [flags]\n");
      return 0;
    }
    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : undefined;
    const pr = backend.resolvePullRequest(repo, selector, currentBranch);

    if (getBoolFlag(parsed, "web")) {
      if (openBrowser) await openBrowser(pr.url);
      await writeOut(`Opening ${pr.url} in your browser.\n`);
      return 0;
    }

    const formatted = await formatCommandOutput({
      data: serializePrForJson(pr),
      availableFields: PR_JSON_FIELDS,
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

    const statusBadge = pr.isDraft ? "DRAFT" : pr.state;
    const outLines: string[] = [
      `${pr.title} #${pr.number}`,
      `${statusBadge} • ${pr.author.login} wants to merge ${pr.commits.length} commit${pr.commits.length === 1 ? "" : "s"} into ${pr.baseRefName} from ${pr.headRefName} • +${pr.additions} -${pr.deletions}`,
    ];
    if (pr.labels.length > 0) {
      outLines.push(`Labels: ${pr.labels.map((l) => l.name).join(", ")}`);
    }
    if (pr.assignees.length > 0) {
      outLines.push(`Assignees: ${pr.assignees.map((a) => a.login).join(", ")}`);
    }
    if (pr.reviewRequests.length > 0 || pr.reviews.length > 0) {
      const reviewerNames = Array.from(
        new Set([
          ...pr.reviewRequests.map((r) => r.login),
          ...pr.reviews.map((r) => `${r.author.login} (${r.state})`),
        ])
      );
      outLines.push(`Reviewers: ${reviewerNames.join(", ")}`);
    }
    if (pr.milestone) {
      outLines.push(`Milestone: ${pr.milestone.title}`);
    }
    outLines.push("", pr.body || "No description provided.", "");
    if (getBoolFlag(parsed, "comments") && pr.comments.length > 0) {
      outLines.push("--- Comments ---");
      for (const c of pr.comments) {
        outLines.push(`${c.author.login} (${c.createdAt}):\n${c.body}\n`);
      }
    }
    outLines.push(`View this pull request on GitHub: ${pr.url}`);
    await writeOut(outLines.join("\n") + "\n");
    return 0;
  }

  // 4. gh pr checkout / co
  if (subcommand === "checkout" || subcommand === "co") {
    const schemas: FlagSchema[] = [
      { short: "b", long: "branch", type: "string" },
      { short: "f", long: "force", type: "boolean" },
      { long: "detach", type: "boolean" },
      { long: "recurse-submodules", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr checkout <number> | <url> | <branch> [flags]\n");
      return 0;
    }
    if (parsed.positionals.length === 0) {
      await writeErr("pull request number, URL, or branch required\n");
      return 1;
    }
    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const pr = backend.resolvePullRequest(repo, selector);

    const gitRoot = (await findGitRoot(context.fs, context.cwd, context.signal)) ?? context.cwd;
    const hasGit = await pathExists(
      context.fs,
      `${gitRoot === "/" ? "" : gitRoot}/.git`,
      context.signal
    );
    if (!hasGit) {
      await runGitInVfs(context, ["init", "-b", repo.defaultBranchRef.name], { cwd: gitRoot, git });
    }

    const targetBranch = getStringFlag(parsed, "branch") ?? pr.headRefName;
    const detach = getBoolFlag(parsed, "detach");
    const headFiles =
      repo.branchFiles.get(pr.headRefName) ??
      repo.branchFiles.get(pr.baseRefName) ??
      repo.branchFiles.get(repo.defaultBranchRef.name) ??
      {};

    await runGitInVfs(context, ["checkout", "-B", targetBranch], { cwd: gitRoot, git });
    await writeWorktreeFiles(context.fs, gitRoot, headFiles, context.signal, true);
    await runGitInVfs(context, ["add", "."], { cwd: gitRoot, git });
    await runGitInVfs(
      context,
      ["commit", "--allow-empty", "-m", `PR #${pr.number}: ${pr.title}`],
      { cwd: gitRoot, git }
    );
    if (detach) {
      await runGitInVfs(context, ["checkout", "--detach", "HEAD"], { cwd: gitRoot, git });
    }

    await writeOut(`Switched to branch '${targetBranch}'\n`);
    return 0;
  }

  // 5. gh pr diff
  if (subcommand === "diff") {
    const schemas: FlagSchema[] = [
      { long: "name-only", type: "boolean" },
      { long: "patch", type: "boolean" },
      { long: "color", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr diff [<number> | <url> | <branch>] [flags]\n");
      return 0;
    }
    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : undefined;
    const pr = backend.resolvePullRequest(repo, selector, currentBranch);

    if (getBoolFlag(parsed, "name-only")) {
      const names = pr.files.map((f) => f.path).join("\n");
      await writeOut(names ? `${names}\n` : "");
      return 0;
    }

    if (getBoolFlag(parsed, "patch")) {
      await writeOut(
        [
          `From ${pr.headRefOid} Mon Sep 17 00:00:00 2001`,
          `From: ${pr.author.login} <${pr.author.login}@github.com>`,
          `Date: ${pr.createdAt}`,
          `Subject: [PATCH] ${pr.title}`,
          "",
          pr.body ? `${pr.body}\n\n---\n` : "---\n",
          pr.diff,
        ].join("\n")
      );
      return 0;
    }

    await writeOut(pr.diff.endsWith("\n") || pr.diff === "" ? pr.diff : `${pr.diff}\n`);
    return 0;
  }

  // 6. gh pr merge
  if (subcommand === "merge") {
    const schemas: FlagSchema[] = [
      { short: "m", long: "merge", type: "boolean" },
      { short: "s", long: "squash", type: "boolean" },
      { short: "r", long: "rebase", type: "boolean" },
      { long: "auto", type: "boolean" },
      { long: "disable-auto", type: "boolean" },
      { short: "d", long: "delete-branch", type: "boolean" },
      { short: "t", long: "subject", type: "string" },
      { short: "b", long: "body", type: "string" },
      { short: "F", long: "body-file", type: "string" },
      { long: "match-head-commit", type: "string" },
      { long: "admin", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr merge [<number> | <url> | <branch>] [flags]\n");
      return 0;
    }

    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : undefined;
    const pr = backend.resolvePullRequest(repo, selector, currentBranch);

    if (getBoolFlag(parsed, "disable-auto")) {
      pr.autoMergeRequest = null;
      await writeOut(`Disabled auto-merge for pull request #${pr.number}\n`);
      return 0;
    }

    const method: "MERGE" | "SQUASH" | "REBASE" = getBoolFlag(parsed, "squash")
      ? "SQUASH"
      : getBoolFlag(parsed, "rebase")
        ? "REBASE"
        : "MERGE";

    if (getBoolFlag(parsed, "auto")) {
      pr.autoMergeRequest = {
        mergeMethod: method,
        enabledAt: backend.isoNow(),
      };
      await writeOut(`Enabled auto-merge (${method.toLowerCase()}) for pull request #${pr.number}\n`);
      return 0;
    }

    if (pr.state === "MERGED") {
      await writeErr(`Pull request #${pr.number} was already merged\n`);
      return 1;
    }
    if (pr.state === "CLOSED") {
      await writeErr(`Pull request #${pr.number} is closed and cannot be merged\n`);
      return 1;
    }
    if (pr.isDraft && !getBoolFlag(parsed, "admin")) {
      await writeErr(
        `Pull request #${pr.number} is a draft and cannot be merged; mark it ready with 'gh pr ready'\n`
      );
      return 1;
    }

    const matchSha = getStringFlag(parsed, "match-head-commit");
    if (matchSha && pr.headRefOid !== matchSha && !pr.headRefOid.startsWith(matchSha)) {
      await writeErr(
        `head commit ${pr.headRefOid} does not match expected ${matchSha}\n`
      );
      return 1;
    }

    if (pr.mergeable === "CONFLICTING" && !getBoolFlag(parsed, "admin")) {
      await writeErr(`Pull request #${pr.number} is not mergeable due to merge conflicts\n`);
      return 1;
    }

    if (env.http) {
      await backend.dispatchHttp(
        {
          url: `https://api.github.com/repos/${repo.owner.login}/${repo.name}/pulls/${pr.number}/merge`,
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: encodeUtf8(
            JSON.stringify({
              merge_method: method.toLowerCase(),
              commit_title: getStringFlag(parsed, "subject") ?? `${pr.title} (#${pr.number})`,
            })
          ),
          signal: context.signal,
        },
        env.http,
        limits
      );
    }

    const headFiles = repo.branchFiles.get(pr.headRefName) ?? {};
    const baseFiles = repo.branchFiles.get(pr.baseRefName) ?? {};
    const mergedFiles = { ...baseFiles, ...headFiles };
    for (const f of pr.files) {
      if (f.status === "removed") delete mergedFiles[f.path];
    }
    repo.branchFiles.set(pr.baseRefName, mergedFiles);

    const mergeOid = bytesToHex(
      sha1Sync(`merged:${repo.nameWithOwner}:${pr.number}:${method}:${backend.isoNow()}`)
    );
    repo.branches.set(pr.baseRefName, mergeOid);
    const subject = getStringFlag(parsed, "subject") ?? `${pr.title} (#${pr.number})`;
    const mergeBody =
      (await readBodyFromFlagOrFile(
        context,
        getStringFlag(parsed, "body"),
        getStringFlag(parsed, "body-file"),
        stdinText
      )) ?? pr.body;

    repo.commits.set(mergeOid, {
      oid: mergeOid,
      messageHeadline: subject,
      messageBody: mergeBody,
      author: {
        name: backend.getActiveUser(),
        email: `${backend.getActiveUser()}@github.com`,
        login: backend.getActiveUser(),
      },
      committedDate: backend.isoNow(),
      parents: [pr.baseRefOid, pr.headRefOid],
      files: mergedFiles,
    });

    pr.state = "MERGED";
    pr.closedAt = backend.isoNow();
    pr.mergedAt = backend.isoNow();
    pr.mergedBy = { login: backend.getActiveUser() };
    pr.mergeCommit = { oid: mergeOid };

    const deleteBranch = getBoolFlag(parsed, "delete-branch") || repo.deleteBranchOnMerge;
    if (deleteBranch) {
      repo.branches.delete(pr.headRefName);
      if (gitRoot) {
        await runGitInVfs(context, ["checkout", "-B", pr.baseRefName], { cwd: gitRoot, git });
        await writeWorktreeFiles(context.fs, gitRoot, mergedFiles, context.signal, true);
        await runGitInVfs(context, ["add", "."], { cwd: gitRoot, git });
        await runGitInVfs(context, ["commit", "--allow-empty", "-m", subject], { cwd: gitRoot, git });
        await runGitInVfs(context, ["branch", "-D", pr.headRefName], { cwd: gitRoot, git });
      }
    }

    await writeOut(
      `✓ Merged pull request #${pr.number} (${pr.title}) via ${method.toLowerCase()}${
        deleteBranch ? ` and deleted branch ${pr.headRefName}` : ""
      }\n`
    );
    return 0;
  }

  // 7. gh pr review
  if (subcommand === "review") {
    const schemas: FlagSchema[] = [
      { short: "a", long: "approve", type: "boolean" },
      { short: "r", long: "request-changes", type: "boolean" },
      { short: "c", long: "comment", type: "boolean" },
      { short: "b", long: "body", type: "string" },
      { short: "F", long: "body-file", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr review [<number> | <url> | <branch>] [flags]\n");
      return 0;
    }

    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : undefined;
    const pr = backend.resolvePullRequest(repo, selector, currentBranch);

    const approve = getBoolFlag(parsed, "approve");
    const requestChanges = getBoolFlag(parsed, "request-changes");
    const commentOnly = getBoolFlag(parsed, "comment");

    if (!approve && !requestChanges && !commentOnly) {
      await writeErr("one of --approve, --request-changes, or --comment is required\n");
      return 1;
    }

    const body =
      (await readBodyFromFlagOrFile(
        context,
        getStringFlag(parsed, "body"),
        getStringFlag(parsed, "body-file"),
        stdinText
      )) ?? "";

    if ((requestChanges || commentOnly) && !body.trim()) {
      await writeErr("body cannot be blank for --request-changes or --comment review\n");
      return 1;
    }

    const state: GhPrReview["state"] = approve
      ? "APPROVED"
      : requestChanges
        ? "CHANGES_REQUESTED"
        : "COMMENTED";

    if (env.http) {
      await backend.dispatchHttp(
        {
          url: `https://api.github.com/repos/${repo.owner.login}/${repo.name}/pulls/${pr.number}/reviews`,
          method: "POST",
          headers: { "content-type": "application/json" },
          body: encodeUtf8(
            JSON.stringify({
              event: approve ? "APPROVE" : requestChanges ? "REQUEST_CHANGES" : "COMMENT",
              body,
            })
          ),
          signal: context.signal,
        },
        env.http,
        limits
      );
    }

    const reviewer = backend.getActiveUser();
    const review: GhPrReview = {
      id: backend.nextId(),
      author: { login: reviewer },
      state,
      body,
      submittedAt: backend.isoNow(),
      commitOid: pr.headRefOid,
    };
    pr.reviews.push(review);
    pr.reviewRequests = pr.reviewRequests.filter(
      (r) => r.login.toLowerCase() !== reviewer.toLowerCase()
    );
    if (state === "APPROVED") pr.reviewDecision = "APPROVED";
    else if (state === "CHANGES_REQUESTED") pr.reviewDecision = "CHANGES_REQUESTED";

    const verb = approve
      ? "Approved"
      : requestChanges
        ? "Requested changes on"
        : "Reviewed";
    await writeOut(`✓ ${verb} pull request #${pr.number}\n`);
    return 0;
  }

  // 8. gh pr checks
  if (subcommand === "checks") {
    const schemas: FlagSchema[] = [
      { long: "required", type: "boolean" },
      { long: "watch", type: "boolean" },
      { long: "fail-fast", type: "boolean" },
      { short: "i", long: "interval", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr checks [<number> | <url> | <branch>] [flags]\n");
      return 0;
    }

    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : undefined;
    const pr = backend.resolvePullRequest(repo, selector, currentBranch);

    const requiredOnly = getBoolFlag(parsed, "required");
    const checks = pr.statusCheckRollup.filter((c) => !requiredOnly || c.isRequired);

    const mappedChecks = checks.map((c) => {
      const bucket =
        c.status !== "completed"
          ? "pending"
          : c.conclusion === "success"
            ? "pass"
            : c.conclusion === "skipped" || c.conclusion === "neutral"
              ? "skipping"
              : "fail";
      return {
        bucket,
        completedAt: c.completedAt ?? null,
        description: c.description ?? "",
        event: "pull_request",
        link: c.detailsUrl,
        name: c.name,
        startedAt: c.startedAt,
        state: (c.conclusion ?? c.status).toUpperCase(),
        workflow: c.workflowName,
      };
    });

    const formatted = await formatCommandOutput({
      data: mappedChecks,
      availableFields: CHECK_JSON_FIELDS,
      jsonFlag: getStringFlag(parsed, "json"),
      jqFlag: getStringFlag(parsed, "jq"),
      templateFlag: getStringFlag(parsed, "template"),
      signal: context.signal,
      maxOutputBytes: limits.maxOutputBytes,
    });
    if (formatted !== undefined) {
      await writeOut(formatted);
    } else {
      const lines = mappedChecks.map(
        (c) => `${c.name}\t${c.bucket}\t1s\t${c.link}\t${c.description}`
      );
      await writeOut(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    }

    if (mappedChecks.some((c) => c.bucket === "fail")) return 1;
    if (mappedChecks.some((c) => c.bucket === "pending")) return 8;
    return 0;
  }

  // 9. gh pr comment
  if (subcommand === "comment") {
    const schemas: FlagSchema[] = [
      { short: "b", long: "body", type: "string" },
      { short: "F", long: "body-file", type: "string" },
      { long: "edit-last", type: "boolean" },
      { long: "delete-last", type: "boolean" },
      { long: "create-if-none", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr comment [<number> | <url> | <branch>] [flags]\n");
      return 0;
    }

    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : undefined;
    const pr = backend.resolvePullRequest(repo, selector, currentBranch);

    const activeUser = backend.getActiveUser();
    if (getBoolFlag(parsed, "delete-last")) {
      for (let idx = pr.comments.length - 1; idx >= 0; idx--) {
        if (pr.comments[idx]!.author.login === activeUser) {
          pr.comments.splice(idx, 1);
          await writeOut("Comment deleted\n");
          return 0;
        }
      }
      await writeErr("no comments found for current user\n");
      return 1;
    }

    const body = await readBodyFromFlagOrFile(
      context,
      getStringFlag(parsed, "body"),
      getStringFlag(parsed, "body-file"),
      stdinText
    );
    if (!body) {
      await writeErr("body cannot be blank; provide -b/--body or -F/--body-file\n");
      return 1;
    }

    if (getBoolFlag(parsed, "edit-last")) {
      for (let idx = pr.comments.length - 1; idx >= 0; idx--) {
        if (pr.comments[idx]!.author.login === activeUser) {
          const prev = pr.comments[idx]!;
          const updated: GhComment = {
            ...prev,
            body,
            updatedAt: backend.isoNow(),
          };
          pr.comments[idx] = updated;
          await writeOut(`${updated.url}\n`);
          return 0;
        }
      }
      if (!getBoolFlag(parsed, "create-if-none")) {
        await writeErr("no comments found for current user to edit\n");
        return 1;
      }
    }

    const id = backend.nextId();
    const ts = backend.isoNow();
    const comment: GhComment = {
      id,
      author: { login: activeUser },
      body,
      createdAt: ts,
      updatedAt: ts,
      url: `${pr.url}#issuecomment-${id}`,
    };
    pr.comments.push(comment);
    await writeOut(`${comment.url}\n`);
    return 0;
  }

  // 10. gh pr edit
  if (subcommand === "edit") {
    const schemas: FlagSchema[] = [
      { short: "t", long: "title", type: "string" },
      { short: "b", long: "body", type: "string" },
      { short: "F", long: "body-file", type: "string" },
      { short: "B", long: "base", type: "string" },
      { long: "add-label", type: "string[]" },
      { long: "remove-label", type: "string[]" },
      { long: "add-assignee", type: "string[]" },
      { long: "remove-assignee", type: "string[]" },
      { long: "add-reviewer", type: "string[]" },
      { long: "remove-reviewer", type: "string[]" },
      { long: "add-project", type: "string[]" },
      { long: "remove-project", type: "string[]" },
      { short: "m", long: "milestone", type: "string" },
      { long: "remove-milestone", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr edit [<number> | <url> | <branch>] [flags]\n");
      return 0;
    }

    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : undefined;
    const pr = backend.resolvePullRequest(repo, selector, currentBranch);

    const newTitle = getStringFlag(parsed, "title");
    if (newTitle !== undefined) pr.title = newTitle;
    const newBody = await readBodyFromFlagOrFile(
      context,
      getStringFlag(parsed, "body"),
      getStringFlag(parsed, "body-file"),
      stdinText
    );
    if (newBody !== undefined) pr.body = newBody;
    const newBase = getStringFlag(parsed, "base");
    if (newBase !== undefined) pr.baseRefName = newBase;

    for (const lblName of getStringArrayFlag(parsed, "add-label")) {
      if (!pr.labels.some((l) => l.name.toLowerCase() === lblName.toLowerCase())) {
        const lbl: GhLabel = repo.labels.get(lblName.toLowerCase()) ?? {
          id: backend.nextId(),
          name: lblName,
          color: "ededed",
          description: "",
        };
        repo.labels.set(lblName.toLowerCase(), lbl);
        pr.labels.push(lbl);
      }
    }
    const removeLabels = getStringArrayFlag(parsed, "remove-label").map((l) => l.toLowerCase());
    if (removeLabels.length > 0) {
      pr.labels = pr.labels.filter((l) => !removeLabels.includes(l.name.toLowerCase()));
    }

    for (const login of getStringArrayFlag(parsed, "add-assignee")) {
      const resolved = login === "@me" ? backend.getActiveUser() : login;
      if (!pr.assignees.some((a) => a.login.toLowerCase() === resolved.toLowerCase())) {
        pr.assignees.push({ login: resolved });
      }
    }
    const removeAssignees = getStringArrayFlag(parsed, "remove-assignee").map((login) =>
      (login === "@me" ? backend.getActiveUser() : login).toLowerCase()
    );
    if (removeAssignees.length > 0) {
      pr.assignees = pr.assignees.filter((a) => !removeAssignees.includes(a.login.toLowerCase()));
    }

    for (const login of getStringArrayFlag(parsed, "add-reviewer")) {
      const resolved = login === "@me" ? backend.getActiveUser() : login;
      if (!pr.reviewRequests.some((r) => r.login.toLowerCase() === resolved.toLowerCase())) {
        pr.reviewRequests.push({ login: resolved });
      }
    }
    const removeReviewers = getStringArrayFlag(parsed, "remove-reviewer").map((r) => r.toLowerCase());
    if (removeReviewers.length > 0) {
      pr.reviewRequests = pr.reviewRequests.filter(
        (r) => !removeReviewers.includes(r.login.toLowerCase())
      );
    }

    if (getBoolFlag(parsed, "remove-milestone")) {
      pr.milestone = null;
    } else if (getStringFlag(parsed, "milestone")) {
      const mTitle = getStringFlag(parsed, "milestone")!;
      pr.milestone = {
        id: backend.nextId(),
        number: 1,
        title: mTitle,
        description: "",
        state: "open",
      };
    }

    pr.updatedAt = backend.isoNow();
    await writeOut(`${pr.url}\n`);
    return 0;
  }

  // 11. gh pr close & reopen
  if (subcommand === "close" || subcommand === "reopen") {
    const schemas: FlagSchema[] = [
      { short: "c", long: "comment", type: "string" },
      { short: "d", long: "delete-branch", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut(`Usage: gh pr ${subcommand} [<number> | <url> | <branch>] [flags]\n`);
      return 0;
    }

    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : undefined;
    const pr = backend.resolvePullRequest(repo, selector, currentBranch);

    const commentText = getStringFlag(parsed, "comment");
    if (commentText) {
      const id = backend.nextId();
      const ts = backend.isoNow();
      pr.comments.push({
        id,
        author: { login: backend.getActiveUser() },
        body: commentText,
        createdAt: ts,
        updatedAt: ts,
        url: `${pr.url}#issuecomment-${id}`,
      });
    }

    if (subcommand === "close") {
      if (pr.state === "MERGED") {
        await writeErr(`Pull request #${pr.number} can't be closed because it was already merged\n`);
        return 1;
      }
      pr.state = "CLOSED";
      pr.closedAt = backend.isoNow();
      if (getBoolFlag(parsed, "delete-branch")) {
        repo.branches.delete(pr.headRefName);
      }
      await writeOut(`✓ Closed pull request #${pr.number} (${pr.title})\n`);
    } else {
      if (pr.state === "MERGED") {
        await writeErr(`Pull request #${pr.number} can't be reopened because it was already merged\n`);
        return 1;
      }
      pr.state = "OPEN";
      pr.closedAt = null;
      await writeOut(`✓ Reopened pull request #${pr.number} (${pr.title})\n`);
    }
    return 0;
  }

  // 12. gh pr ready
  if (subcommand === "ready") {
    const schemas: FlagSchema[] = [{ long: "undo", type: "boolean" }];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr ready [<number> | <url> | <branch>] [--undo]\n");
      return 0;
    }

    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : undefined;
    const pr = backend.resolvePullRequest(repo, selector, currentBranch);

    const undo = getBoolFlag(parsed, "undo");
    pr.isDraft = undo;
    pr.mergeStateStatus = undo ? "DRAFT" : "CLEAN";
    pr.updatedAt = backend.isoNow();

    if (undo) {
      await writeOut(`✓ Pull request #${pr.number} is converted to "draft"\n`);
    } else {
      await writeOut(`✓ Pull request #${pr.number} is marked as "ready for review"\n`);
    }
    return 0;
  }

  // 13. gh pr lock & unlock
  if (subcommand === "lock" || subcommand === "unlock") {
    const schemas: FlagSchema[] = [{ short: "r", long: "reason", type: "string" }];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut(`Usage: gh pr ${subcommand} [<number> | <url> | <branch>]\n`);
      return 0;
    }

    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : undefined;
    const pr = backend.resolvePullRequest(repo, selector, currentBranch);

    if (subcommand === "lock") {
      pr.locked = true;
      pr.activeLockReason = getStringFlag(parsed, "reason") ?? null;
      await writeOut(`✓ Locked pull request #${pr.number}\n`);
    } else {
      pr.locked = false;
      pr.activeLockReason = null;
      await writeOut(`✓ Unlocked pull request #${pr.number}\n`);
    }
    return 0;
  }

  // 14. gh pr status
  if (subcommand === "status") {
    const schemas: FlagSchema[] = [{ short: "c", long: "conflict-status", type: "boolean" }];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr status [flags]\n");
      return 0;
    }

    const coords = await resolveRepoFromContext(
      context,
      parsed.repoFlag,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : "main";
    const viewer = backend.getActiveUser();

    const allPrs = Array.from(repo.pullRequests.values());
    const currentBranchPr =
      allPrs.find((p) => p.headRefName === currentBranch && p.state === "OPEN") ??
      allPrs.find((p) => p.headRefName === currentBranch) ??
      null;
    const createdByYou = allPrs.filter(
      (p) => p.state === "OPEN" && p.author.login.toLowerCase() === viewer.toLowerCase()
    );
    const needsReview = allPrs.filter(
      (p) =>
        p.state === "OPEN" &&
        p.reviewRequests.some((r) => r.login.toLowerCase() === viewer.toLowerCase())
    );

    const statusObj = {
      currentBranch: currentBranchPr ? serializePrForJson(currentBranchPr) : null,
      createdBy: createdByYou.map((p) => serializePrForJson(p)),
      needsReview: needsReview.map((p) => serializePrForJson(p)),
    };

    const formatted = await formatCommandOutput({
      data: statusObj,
      availableFields: ["currentBranch", "createdBy", "needsReview"],
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

    const lines: string[] = [
      `Relevant pull requests in ${repo.nameWithOwner}`,
      "",
      "Current branch",
      currentBranchPr
        ? `  #${currentBranchPr.number}  ${currentBranchPr.title} [${currentBranchPr.headRefName}]`
        : `  There is no pull request associated with [${currentBranch}]`,
      "",
      "Created by you",
      ...(createdByYou.length > 0
        ? createdByYou.map((p) => `  #${p.number}  ${p.title} [${p.headRefName}]`)
        : ["  You have no open pull requests"]),
      "",
      "Requesting a code review from you",
      ...(needsReview.length > 0
        ? needsReview.map((p) => `  #${p.number}  ${p.title} [${p.headRefName}]`)
        : ["  You have no pull requests to review"]),
      "",
    ];
    await writeOut(lines.join("\n"));
    return 0;
  }

  // 15. gh pr update-branch
  if (subcommand === "update-branch") {
    const schemas: FlagSchema[] = [{ long: "rebase", type: "boolean" }];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr update-branch [<number> | <url> | <branch>] [--rebase]\n");
      return 0;
    }

    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
    const currentBranch = gitRoot ? await readCurrentBranch(context, gitRoot, git) : undefined;
    const pr = backend.resolvePullRequest(repo, selector, currentBranch);

    const baseFiles = repo.branchFiles.get(pr.baseRefName) ?? {};
    const headFiles = repo.branchFiles.get(pr.headRefName) ?? {};
    const combined = { ...baseFiles, ...headFiles };
    repo.branchFiles.set(pr.headRefName, combined);
    const updatedOid = bytesToHex(
      sha1Sync(`updated:${pr.headRefOid}:${pr.baseRefOid}:${getBoolFlag(parsed, "rebase")}`)
    );
    pr.headRefOid = updatedOid;
    repo.branches.set(pr.headRefName, updatedOid);
    const diffStats = computeDiffBetweenFileMaps(baseFiles, combined);
    pr.diff = diffStats.diff;
    pr.files = diffStats.files;
    pr.additions = diffStats.additions;
    pr.deletions = diffStats.deletions;
    pr.changedFiles = diffStats.changedFiles;
    pr.mergeStateStatus = pr.isDraft ? "DRAFT" : "CLEAN";
    pr.updatedAt = backend.isoNow();

    await writeOut(`✓ Pull request #${pr.number} branch updated\n`);
    return 0;
  }

  // 16. gh pr revert
  if (subcommand === "revert") {
    const schemas: FlagSchema[] = [
      { short: "t", long: "title", type: "string" },
      { short: "b", long: "body", type: "string" },
      { short: "F", long: "body-file", type: "string" },
      { short: "d", long: "draft", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh pr revert [<number> | <url> | <branch>] [flags]\n");
      return 0;
    }
    const { repoOverride, selector } = extractRepoAndSelectorFromPrArg(
      parsed.positionals[0],
      parsed.repoFlag
    );
    const coords = await resolveRepoFromContext(
      context,
      repoOverride,
      backend.defaultHost,
      backend.getActiveUser()
    );
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const pr = backend.resolvePullRequest(repo, selector);
    if (pr.state !== "MERGED") {
      await writeErr(`Pull request #${pr.number} cannot be reverted because it has not been merged\n`);
      return 1;
    }
    const revertBranch = `revert-${pr.number}-${pr.headRefName}`;
    const revertTitle = getStringFlag(parsed, "title") ?? `Revert "${pr.title}"`;
    const revertBody =
      (await readBodyFromFlagOrFile(
        context,
        getStringFlag(parsed, "body"),
        getStringFlag(parsed, "body-file"),
        stdinText
      )) ?? `Reverts ${repo.nameWithOwner}#${pr.number}`;

    const revertPr = backend.createPullRequest(repo, {
      title: revertTitle,
      body: revertBody,
      headRefName: revertBranch,
      baseRefName: pr.baseRefName,
      isDraft: getBoolFlag(parsed, "draft"),
    });
    await writeOut(`${revertPr.url}\n`);
    return 0;
  }

  await writeErr(`unknown command "${subcommand}" for "gh pr"\n`);
  return 1;
}
