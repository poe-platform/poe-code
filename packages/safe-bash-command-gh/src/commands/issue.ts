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
import { decodeUtf8 } from "../crypto-ssh.js";
import { findGitRoot, parseRepoSpec, resolveRepoFromContext, runGitInVfs } from "../git-vfs.js";
import { formatCommandOutput } from "../template.js";
import type { GhBrowserOpener, GhComment, GhIssue, GhLabel, GhLimits } from "../types.js";

export function extractRepoAndSelectorFromIssueArg(
  selector: string | undefined,
  explicitRepoFlag: string | undefined
): { readonly repoOverride: string | undefined; readonly selector: string | undefined } {
  if (selector?.startsWith("https://") || selector?.startsWith("http://")) {
    const url = new URL(selector);
    const parts = url.pathname.split("/");
    if (parts.length === 5 && parts[1] && parts[2] && parts[3] === "issues" &&
        parts[4] && Number.isSafeInteger(Number(parts[4])) && Number(parts[4]) > 0) {
      return {
        repoOverride: explicitRepoFlag ?? `${url.host}/${parts[1]}/${parts[2]}`,
        selector: parts[4],
      };
    }
  }
  return { repoOverride: explicitRepoFlag, selector };
}

export const ISSUE_JSON_FIELDS: readonly string[] = [
  "assignees",
  "author",
  "body",
  "closed",
  "closedAt",
  "comments",
  "createdAt",
  "id",
  "isPinned",
  "labels",
  "milestone",
  "number",
  "projectCards",
  "projectItems",
  "reactionGroups",
  "state",
  "stateReason",
  "title",
  "updatedAt",
  "url",
];

function serializeIssueForJson(issue: GhIssue): Record<string, unknown> {
  return {
    ...issue,
    id: `I_${issue.number}`,
    closed: issue.state === "CLOSED",
    projectCards: [],
    reactionGroups: [],
  };
}

export interface IssueHandlerEnv {
  readonly context: CommandContext;
  readonly backend: GitHubBackend;
  readonly git?: CommandDefinition | CommandHandler | undefined;
  readonly openBrowser?: GhBrowserOpener | undefined;
  readonly limits: GhLimits;
  readonly stdinText: string;
  readonly writeOut: (text: string) => Promise<void>;
  readonly writeErr: (text: string) => Promise<void>;
}

export async function handleIssueCommand(
  env: IssueHandlerEnv,
  rawArgs: readonly string[]
): Promise<number> {
  const { context, backend, git, openBrowser, limits, stdinText, writeOut, writeErr } = env;
  const subcommand = rawArgs[0];
  const restArgs = rawArgs.slice(1);

  if (!subcommand || subcommand === "--help" || subcommand === "-h" || subcommand === "help") {
    await writeOut(
      [
        "Work with GitHub issues.",
        "",
        "USAGE",
        "  gh issue <command> [flags]",
        "",
        "GENERAL COMMANDS",
        "  create:      Create a new issue",
        "  list (ls):   List issues in a repository",
        "  status:      Show status of relevant issues",
        "",
        "TARGETED COMMANDS",
        "  view:        View an issue",
        "  comment:     Add a comment to an issue",
        "  close:       Close an issue",
        "  reopen:      Reopen an issue",
        "  edit:        Edit an issue",
        "  delete:      Delete an issue",
        "  pin:         Pin a issue",
        "  unpin:       Unpin a issue",
        "  lock:        Lock issue conversation",
        "  unlock:      Unlock issue conversation",
        "  transfer:    Transfer issue to another repository",
        "  develop:     Manage linked branches for an issue",
        "",
      ].join("\n")
    );
    return 0;
  }

  if (subcommand === "create" || subcommand === "new") {
    const schemas: FlagSchema[] = [
      { short: "t", long: "title", type: "string" },
      { short: "b", long: "body", type: "string" },
      { short: "F", long: "body-file", type: "string" },
      { short: "l", long: "label", type: "string[]" },
      { short: "a", long: "assignee", type: "string[]" },
      { short: "m", long: "milestone", type: "string" },
      { short: "p", long: "project", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    if (parsed.help) {
      await writeOut("Usage: gh issue create [flags]\n");
      return 0;
    }

    const coords = await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const title = getStringFlag(parsed, "title") ?? "New issue";
    const bodyFile = getStringFlag(parsed, "body-file");
    const body =
      bodyFile !== undefined
        ? bodyFile === "-"
          ? stdinText
          : decodeUtf8(await context.fs.readFile(resolvePath(context.cwd, bodyFile), { signal: context.signal }))
        : (getStringFlag(parsed, "body") ?? "");

    const issue = backend.createIssue(repo, {
      title,
      body,
      labels: getStringArrayFlag(parsed, "label"),
      assignees: getStringArrayFlag(parsed, "assignee"),
      milestone: getStringFlag(parsed, "milestone"),
      project: getStringFlag(parsed, "project"),
    });
    await writeOut(`${issue.url}\n`);
    return 0;
  }

  if (subcommand === "list" || subcommand === "ls") {
    const schemas: FlagSchema[] = [
      { short: "s", long: "state", type: "string" },
      { short: "l", long: "label", type: "string[]" },
      { short: "A", long: "author", type: "string" },
      { short: "a", long: "assignee", type: "string" },
      { short: "S", long: "search", type: "string" },
      { short: "L", long: "limit", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const coords = await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const stateFilter = (getStringFlag(parsed, "state") ?? "open").toLowerCase();
    const labelFilters = getStringArrayFlag(parsed, "label").map((l) => l.toLowerCase());
    const rawAuthor = getStringFlag(parsed, "author");
    const authorFilter = rawAuthor === "@me" ? backend.getActiveUser() : rawAuthor;
    const rawAssignee = getStringFlag(parsed, "assignee");
    const assigneeFilter = rawAssignee === "@me" ? backend.getActiveUser() : rawAssignee;
    const searchFilter = getStringFlag(parsed, "search")?.toLowerCase();
    const limit = Math.min(getIntFlag(parsed, "limit", 30), limits.maxItems);

    let items = Array.from(repo.issues.values()).sort((a, b) => b.number - a.number);
    items = items.filter((iss) => {
      if (stateFilter === "open" && iss.state !== "OPEN") return false;
      if (stateFilter === "closed" && iss.state !== "CLOSED") return false;
      if (authorFilter && iss.author.login.toLowerCase() !== authorFilter.toLowerCase()) return false;
      if (assigneeFilter && !iss.assignees.some((a) => a.login.toLowerCase() === assigneeFilter.toLowerCase()))
        return false;
      for (const lbl of labelFilters) {
        if (!iss.labels.some((l) => l.name.toLowerCase() === lbl)) return false;
      }
      if (searchFilter && !`${iss.title} ${iss.body}`.toLowerCase().includes(searchFilter)) return false;
      return true;
    });
    items = items.slice(0, limit);

    const formatted = await formatCommandOutput({
      data: items.map((i) => serializeIssueForJson(i)),
      availableFields: ISSUE_JSON_FIELDS,
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

    const lines = items.map(
      (i) => `${i.number}\t${i.state}\t${i.title}\t${i.labels.map((l) => l.name).join(", ")}\t${i.updatedAt}`
    );
    await writeOut(lines.join("\n") + (lines.length > 0 ? "\n" : ""));
    return 0;
  }

  if (subcommand === "view") {
    const schemas: FlagSchema[] = [{ short: "c", long: "comments", type: "boolean" }];
    const parsed = parseCommandArgs(restArgs, schemas);
    const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
    const coords = await resolveRepoFromContext(context, repoOverride, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const issue = backend.resolveIssue(repo, selector ?? "1");

    if (getBoolFlag(parsed, "web")) {
      if (openBrowser) await openBrowser(issue.url);
      await writeOut(`Opening ${issue.url} in your browser.\n`);
      return 0;
    }

    const formatted = await formatCommandOutput({
      data: serializeIssueForJson(issue),
      availableFields: ISSUE_JSON_FIELDS,
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
      `${issue.title} #${issue.number}`,
      `${issue.state} • ${issue.author.login} opened ${issue.createdAt}`,
      ...(issue.labels.length > 0 ? [`Labels: ${issue.labels.map((l) => l.name).join(", ")}`] : []),
      "",
      issue.body || "No description provided.",
      "",
    ];
    if (getBoolFlag(parsed, "comments") && issue.comments.length > 0) {
      for (const c of issue.comments) {
        lines.push(`${c.author.login} (${c.createdAt}):\n${c.body}\n`);
      }
    }
    lines.push(`View this issue on GitHub: ${issue.url}`);
    await writeOut(lines.join("\n") + "\n");
    return 0;
  }

  if (subcommand === "close" || subcommand === "reopen") {
    const schemas: FlagSchema[] = [
      { short: "c", long: "comment", type: "string" },
      { short: "r", long: "reason", type: "string" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
    const coords = await resolveRepoFromContext(context, repoOverride, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const issue = backend.resolveIssue(repo, selector ?? "1");

    const commentText = getStringFlag(parsed, "comment");
    if (commentText) {
      const id = backend.nextId();
      const ts = backend.isoNow();
      issue.comments.push({
        id,
        author: { login: backend.getActiveUser() },
        body: commentText,
        createdAt: ts,
        updatedAt: ts,
        url: `${issue.url}#issuecomment-${id}`,
      });
    }

    if (subcommand === "close") {
      issue.state = "CLOSED";
      issue.closedAt = backend.isoNow();
      const reason = getStringFlag(parsed, "reason")?.toUpperCase();
      issue.stateReason = reason === "NOT PLANNED" || reason === "NOT_PLANNED" ? "NOT_PLANNED" : "COMPLETED";
      await writeOut(`✓ Closed issue #${issue.number} (${issue.title})\n`);
    } else {
      issue.state = "OPEN";
      issue.closedAt = null;
      issue.stateReason = "REOPENED";
      await writeOut(`✓ Reopened issue #${issue.number} (${issue.title})\n`);
    }
    return 0;
  }

  if (subcommand === "comment") {
    const schemas: FlagSchema[] = [
      { short: "b", long: "body", type: "string" },
      { short: "F", long: "body-file", type: "string" },
      { long: "edit-last", type: "boolean" },
      { long: "delete-last", type: "boolean" },
      { long: "create-if-none", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
    const coords = await resolveRepoFromContext(context, repoOverride, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const issue = backend.resolveIssue(repo, selector ?? "1");
    const activeUser = backend.getActiveUser();
    let lastIndex = -1;
    for (let index = issue.comments.length - 1; index >= 0; index--) {
      if (issue.comments[index]!.author.login === activeUser) {
        lastIndex = index;
        break;
      }
    }
    if (getBoolFlag(parsed, "delete-last")) {
      if (lastIndex < 0) {
        await writeErr("no comments found for current user\n");
        return 1;
      }
      issue.comments.splice(lastIndex, 1);
      issue.updatedAt = backend.isoNow();
      await writeOut("Comment deleted\n");
      return 0;
    }
    const bodyFile = getStringFlag(parsed, "body-file");
    const body =
      bodyFile !== undefined
        ? bodyFile === "-"
          ? stdinText
          : decodeUtf8(await context.fs.readFile(resolvePath(context.cwd, bodyFile), { signal: context.signal }))
        : (getStringFlag(parsed, "body") ?? "");
    if (!body) {
      await writeErr("body cannot be blank; provide -b/--body or -F/--body-file\n");
      return 1;
    }
    if (getBoolFlag(parsed, "edit-last")) {
      if (lastIndex >= 0) {
        const previous = issue.comments[lastIndex]!;
        issue.comments[lastIndex] = { ...previous, body, updatedAt: backend.isoNow() };
        issue.updatedAt = issue.comments[lastIndex]!.updatedAt;
        await writeOut(`${previous.url}\n`);
        return 0;
      }
      if (!getBoolFlag(parsed, "create-if-none")) {
        await writeErr("no comments found for current user to edit\n");
        return 1;
      }
    }
    const id = backend.nextId();
    const ts = backend.isoNow();
    const c: GhComment = {
      id,
      author: { login: backend.getActiveUser() },
      body,
      createdAt: ts,
      updatedAt: ts,
      url: `${issue.url}#issuecomment-${id}`,
    };
    issue.comments.push(c);
    issue.updatedAt = ts;
    await writeOut(`${c.url}\n`);
    return 0;
  }

  if (subcommand === "edit") {
    const schemas: FlagSchema[] = [
      { short: "t", long: "title", type: "string" },
      { short: "b", long: "body", type: "string" },
      { short: "F", long: "body-file", type: "string" },
      { short: "m", long: "milestone", type: "string" },
      { long: "remove-milestone", type: "boolean" },
      { long: "add-project", type: "string[]" },
      { long: "remove-project", type: "string[]" },
      { long: "add-label", type: "string[]" },
      { long: "remove-label", type: "string[]" },
      { long: "add-assignee", type: "string[]" },
      { long: "remove-assignee", type: "string[]" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
    const coords = await resolveRepoFromContext(context, repoOverride, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const issue = backend.resolveIssue(repo, selector ?? "1");

    const title = getStringFlag(parsed, "title");
    if (title !== undefined) issue.title = title;
    const bodyFile = getStringFlag(parsed, "body-file");
    const body = bodyFile !== undefined
      ? bodyFile === "-" ? stdinText
        : decodeUtf8(await context.fs.readFile(resolvePath(context.cwd, bodyFile), { signal: context.signal }))
      : getStringFlag(parsed, "body");
    if (body !== undefined) issue.body = body;
    for (const lblName of getStringArrayFlag(parsed, "add-label")) {
      if (!issue.labels.some((l) => l.name.toLowerCase() === lblName.toLowerCase())) {
        const lbl: GhLabel = repo.labels.get(lblName.toLowerCase()) ?? {
          id: backend.nextId(),
          name: lblName,
          color: "ededed",
          description: "",
        };
        issue.labels.push(lbl);
      }
    }
    const rmLabels = getStringArrayFlag(parsed, "remove-label").map((l) => l.toLowerCase());
    if (rmLabels.length > 0) {
      issue.labels = issue.labels.filter((l) => !rmLabels.includes(l.name.toLowerCase()));
    }
    for (const login of getStringArrayFlag(parsed, "add-assignee")) {
      const resolved = login === "@me" ? backend.getActiveUser() : login;
      if (!issue.assignees.some(a => a.login.toLowerCase() === resolved.toLowerCase())) {
        issue.assignees.push({ login: resolved });
      }
    }
    const removeAssignees = getStringArrayFlag(parsed, "remove-assignee").map(login =>
      (login === "@me" ? backend.getActiveUser() : login).toLowerCase());
    issue.assignees = issue.assignees.filter(a => !removeAssignees.includes(a.login.toLowerCase()));

    const milestone = getStringFlag(parsed, "milestone");
    if (getBoolFlag(parsed, "remove-milestone")) {
      issue.milestone = null;
    } else if (milestone !== undefined) {
      issue.milestone = { id: backend.nextId(), number: 1, title: milestone, description: "", state: "open" };
    }
    for (const title of getStringArrayFlag(parsed, "add-project")) {
      if (!issue.projectItems.some(project => project.title === title)) {
        issue.projectItems.push({ title });
      }
    }
    const removeProjects = getStringArrayFlag(parsed, "remove-project");
    issue.projectItems = issue.projectItems.filter(project => !removeProjects.includes(project.title));
    issue.updatedAt = backend.isoNow();
    await writeOut(`${issue.url}\n`);
    return 0;
  }

  if (subcommand === "delete") {
    const parsed = parseCommandArgs(restArgs, []);
    const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
    const coords = await resolveRepoFromContext(context, repoOverride, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const issue = backend.resolveIssue(repo, selector ?? "1");
    repo.issues.delete(issue.number);
    await writeOut(`✓ Deleted issue #${issue.number}\n`);
    return 0;
  }

  if (subcommand === "pin" || subcommand === "unpin") {
    const parsed = parseCommandArgs(restArgs, []);
    const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
    const coords = await resolveRepoFromContext(context, repoOverride, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const issue = backend.resolveIssue(repo, selector ?? "1");
    issue.isPinned = subcommand === "pin";
    await writeOut(`✓ ${subcommand === "pin" ? "Pinned" : "Unpinned"} issue #${issue.number}\n`);
    return 0;
  }

  if (subcommand === "lock" || subcommand === "unlock") {
    const parsed = parseCommandArgs(restArgs, [{ short: "r", long: "reason", type: "string" }]);
    const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
    const coords = await resolveRepoFromContext(context, repoOverride, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const issue = backend.resolveIssue(repo, selector ?? "1");
    issue.locked = subcommand === "lock";
    await writeOut(`✓ ${subcommand === "lock" ? "Locked" : "Unlocked"} issue #${issue.number}\n`);
    return 0;
  }

  if (subcommand === "transfer") {
    const parsed = parseCommandArgs(restArgs, []);
    const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
    const coords = await resolveRepoFromContext(context, repoOverride, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const issue = backend.resolveIssue(repo, selector ?? "1");
    const destSpec = parsed.positionals[1];
    if (!destSpec) {
      await writeErr("destination repository required\n");
      return 1;
    }
    const destCoords = parseRepoSpec(destSpec, backend.defaultHost, backend.getActiveUser());
    const destRepo = backend.getOrCreateRepo(destCoords.owner, destCoords.name);
    repo.issues.delete(issue.number);
    const transferred = backend.createIssue(destRepo, {
      title: issue.title,
      body: issue.body,
      labels: issue.labels.map((l) => l.name),
      assignees: issue.assignees.map((a) => a.login),
    });
    await writeOut(`${transferred.url}\n`);
    return 0;
  }

  if (subcommand === "develop") {
    const schemas: FlagSchema[] = [
      { short: "n", long: "name", type: "string" },
      { short: "b", long: "base", type: "string" },
      { short: "c", long: "checkout", type: "boolean" },
      { short: "l", long: "list", type: "boolean" },
    ];
    const parsed = parseCommandArgs(restArgs, schemas);
    const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
    const coords = await resolveRepoFromContext(context, repoOverride, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const issue = backend.resolveIssue(repo, selector ?? "1");

    if (getBoolFlag(parsed, "list")) {
      await writeOut(issue.linkedBranches.map((b) => `${b}\t${repo.url}/tree/${b}`).join("\n") + (issue.linkedBranches.length > 0 ? "\n" : ""));
      return 0;
    }

    const slug = issue.title
      .toLowerCase()
      .replace(/[^a-z0-9]+/gu, "-")
      .replace(/^-|-$/gu, "");
    const branchName = getStringFlag(parsed, "name") ?? `${issue.number}-${slug}`;
    const baseBranch = getStringFlag(parsed, "base") ?? repo.defaultBranchRef.name;
    const baseFiles = repo.branchFiles.get(baseBranch) ?? {};
    repo.branchFiles.set(branchName, { ...baseFiles });
    repo.branches.set(branchName, repo.branches.get(baseBranch) ?? "");
    if (!issue.linkedBranches.includes(branchName)) {
      issue.linkedBranches.push(branchName);
    }

    if (getBoolFlag(parsed, "checkout")) {
      const gitRoot = await findGitRoot(context.fs, context.cwd, context.signal);
      if (gitRoot) {
        await runGitInVfs(context, ["checkout", "-B", branchName], { cwd: gitRoot, git });
      }
    }

    await writeOut(`${repo.url}/tree/${branchName}\n`);
    return 0;
  }

  if (subcommand === "status") {
    const parsed = parseCommandArgs(restArgs, []);
    const coords = await resolveRepoFromContext(context, parsed.repoFlag, backend.defaultHost, backend.getActiveUser());
    const repo = backend.getOrCreateRepo(coords.owner, coords.name);
    const viewer = backend.getActiveUser();
    const assigned = Array.from(repo.issues.values()).filter(
      (i) => i.state === "OPEN" && i.assignees.some((a) => a.login.toLowerCase() === viewer.toLowerCase())
    );
    const created = Array.from(repo.issues.values()).filter(
      (i) => i.state === "OPEN" && i.author.login.toLowerCase() === viewer.toLowerCase()
    );
    await writeOut(
      [
        `Relevant issues in ${repo.nameWithOwner}`,
        "",
        "Assigned to you",
        ...(assigned.length > 0 ? assigned.map((i) => `  #${i.number}  ${i.title}`) : ["  There are no issues assigned to you"]),
        "",
        "Created by you",
        ...(created.length > 0 ? created.map((i) => `  #${i.number}  ${i.title}`) : ["  You have no open issues"]),
        "",
      ].join("\n")
    );
    return 0;
  }

  await writeErr(`unknown command "${subcommand}" for "gh issue"\n`);
  return 1;
}
