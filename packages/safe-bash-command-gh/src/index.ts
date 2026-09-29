import { createGhInput } from "./input.js";
import {
  commandRuntimeIdentity,
  writeBytes,
  type CommandContext,
  type CommandDefinition,
  type CommandHandler,
  type VirtualShellPlugin,
} from "safe-bash-contracts";
import {
  getBoolFlag,
  getIntFlag,
  getRawStringArrayFlag,
  getStringArrayFlag,
  getStringFlag,
  parseCommandArgs,
  type FlagSchema,
} from "./args.js";
import { createGitHubBackend, GitHubBackend } from "./backend.js";
import { extractRepoAndSelectorFromIssueArg, ISSUE_JSON_FIELDS } from "./commands/issue.js";
import { PR_JSON_FIELDS } from "./commands/pr.js";
import { RELEASE_JSON_FIELDS } from "./commands/release-run-workflow.js";
import { REPO_JSON_FIELDS } from "./commands/repo.js";
import { bytesToHex, sha1Sync } from "./crypto-ssh.js";
import { parseRepoSpec, type RepoCoordinates } from "./git-vfs.js";
import { formatCommandOutputSync } from "./template.js";
import type { GhIssue, GhLabel, GhPullRequest, GhRelease, GhRepo, GhVariable } from "./types.js";
import { handleApiCommand } from "./commands/api.js";
import { handleAuthCommand } from "./commands/auth.js";
import { handleIssueCommand } from "./commands/issue.js";
import {
  handleAliasCommand,
  handleAttestationCommand,
  handleBrowseCommand,
  handleCacheCommand,
  handleCodespaceCommand,
  handleConfigCommand,
  handleExtensionCommand,
  handleGistCommand,
  handleGpgKeyCommand,
  handleLabelCommand,
  handleOrgCommand,
  handleProjectCommand,
  handleRulesetCommand,
  handleSearchCommand,
  handleSecretCommand,
  handleSshKeyCommand,
  handleStatusCommand,
  handleVariableCommand,
} from "./commands/misc.js";
import { handlePrCommand } from "./commands/pr.js";
import {
  handleReleaseCommand,
  handleRunCommand,
  handleWorkflowCommand,
} from "./commands/release-run-workflow.js";
import { handleRepoCommand } from "./commands/repo.js";
import {
  createDefaultOpenSslProvider,
  createDefaultSshProvider,
  decodeUtf8,
  encodeUtf8,
} from "./crypto-ssh.js";
import {
  DEFAULT_GH_LIMITS,
  type GhBrowserOpener,
  type GhHttpTransport,
  type GhLimits,
  type GhOpenSslProvider,
  type GhSshProvider,
} from "./types.js";

export * from "./types.js";
export { GitHubBackend, createGitHubBackend } from "./backend.js";
export {
  createDefaultOpenSslProvider,
  createDefaultSshProvider,
} from "./crypto-ssh.js";
export { parseRepoSpec } from "./git-vfs.js";

export interface GhCommandOptions {
  readonly backend?: GitHubBackend | undefined;
  readonly http?: GhHttpTransport | undefined;
  readonly openssl?: Partial<GhOpenSslProvider> | undefined;
  readonly ssh?: Partial<GhSshProvider> | undefined;
  readonly git?: CommandDefinition | CommandHandler | undefined;
  readonly openBrowser?: GhBrowserOpener | undefined;
  readonly limits?: Partial<GhLimits> | undefined;
  readonly defaultHost?: string | undefined;
  readonly defaultUser?: string | undefined;
  readonly defaultToken?: string | undefined;
  readonly now?: (() => Date) | undefined;
}

export interface GhCommandsOptions extends GhCommandOptions {
  readonly replace?: boolean | undefined;
}

const GH_VERSION_OUTPUT = "gh version 2.67.0 (2026-09-28)\nhttps://github.com/cli/cli/releases/tag/v2.67.0\n";

const GH_ROOT_HELP = [
  "Work seamlessly with GitHub from the command line.",
  "",
  "USAGE",
  "  gh <command> <subcommand> [flags]",
  "",
  "CORE COMMANDS",
  "  auth:        Authenticate gh and git with GitHub",
  "  browse:      Open the repository in the browser",
  "  codespace:   Connect to and manage codespaces",
  "  gist:        Manage gists",
  "  issue:       Manage issues",
  "  org:         Manage organizations",
  "  pr:          Manage pull requests",
  "  project:     Work with GitHub Projects",
  "  release:     Manage releases",
  "  repo:        Manage repositories",
  "",
  "GITHUB ACTIONS COMMANDS",
  "  cache:       Manage GitHub Actions caches",
  "  run:         View details about workflow runs",
  "  workflow:    View details about GitHub Actions workflows",
  "",
  "ADDITIONAL COMMANDS",
  "  alias:       Create command shortcuts",
  "  api:         Make an authenticated GitHub API request",
  "  attestation: Work with artifact attestations",
  "  completion:  Generate shell completion scripts",
  "  config:      Manage configuration for gh",
  "  extension:   Manage gh extensions",
  "  gpg-key:     Manage GPG keys",
  "  label:       Manage labels",
  "  ruleset:     View info about repo rulesets",
  "  search:      Search for repositories, issues, and pull requests",
  "  secret:      Manage GitHub secrets",
  "  ssh-key:     Manage SSH keys",
  "  status:      Print information about relevant issues, pull requests, and notifications",
  "  variable:    Manage GitHub Actions variables",
  "  version:     Show gh version",
  "",
].join("\n");

function splitAliasExpansion(expansion: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < expansion.length; i++) {
    const ch = expansion[i]!;
    if (quote) {
      if (ch === quote) quote = null;
      else current += ch;
    } else if (ch === '"' || ch === "'") {
      quote = ch;
    } else if (/\s/u.test(ch)) {
      if (current) {
        tokens.push(current);
        current = "";
      }
    } else {
      current += ch;
    }
  }
  if (current) tokens.push(current);
  return tokens;
}

function normalizeTopLevelArgs(rawArgs: readonly string[]): {
  readonly command: string | undefined;
  readonly subArgs: string[];
  readonly version: boolean;
  readonly help: boolean;
} {
  const preFlags: string[] = [];
  let idx = 0;
  let version = false;
  let help = false;

  while (idx < rawArgs.length) {
    const tok = rawArgs[idx]!;
    if (tok === "--version" || tok === "-v") {
      version = true;
      idx++;
      continue;
    }
    if ((tok === "-R" || tok === "--repo") && rawArgs[idx + 1] !== undefined) {
      preFlags.push("-R", rawArgs[idx + 1]!);
      idx += 2;
      continue;
    }
    if (tok.startsWith("--repo=") || tok.startsWith("-R=")) {
      preFlags.push(tok);
      idx++;
      continue;
    }
    if (tok === "--help" || tok === "-h") {
      help = true;
      idx++;
      continue;
    }
    break;
  }

  const command = rawArgs[idx];
  const remaining = rawArgs.slice(idx + 1);
  return {
    command,
    subArgs: [...remaining, ...preFlags],
    version,
    help: help && !command,
  };
}

export function createGhCommand(options: GhCommandOptions = {}): CommandDefinition {
  const limits: GhLimits = { ...DEFAULT_GH_LIMITS, ...options.limits };
  const backends = new WeakMap<CommandContext["fs"], GitHubBackend>();
  const openssl = createDefaultOpenSslProvider(options.openssl);

  const def: CommandDefinition = {
    name: "gh",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Work seamlessly with GitHub from the command line",
    async execute(context: CommandContext) {
      context.signal.throwIfAborted();
      let backend = options.backend ?? backends.get(context.fs);
      if (!backend) {
        backend = createGitHubBackend({
          defaultHost: options.defaultHost,
          defaultUser: options.defaultUser,
          defaultToken: options.defaultToken,
          now: options.now,
        });
        backends.set(context.fs, backend);
      }
      backend.resetUsage();
      const ssh = createDefaultSshProvider(options.ssh, backend.getActiveUser());
      const input = createGhInput(context, limits);
      context = { ...context, fs: input.fs };

      let outputBytes = 0;
      const writeOut = async (text: string) => {
        input.assertWithinLimits();
        const bytes = encodeUtf8(text);
        outputBytes += bytes.length;
        if (outputBytes > limits.maxOutputBytes) {
          throw new Error("gh output byte limit exceeded");
        }
        await writeBytes(context.stdout, bytes, context.signal);
      };
      const writeErr = async (text: string) => {
        const bytes = encodeUtf8(text);
        await writeBytes(context.stderr, bytes, context.signal);
      };

      try {
        const readStdinBytes = input.readStdinBytes;
        const readStdinText = async () => decodeUtf8(await readStdinBytes());

        const dispatch = async (argsToRun: readonly string[], depth = 0): Promise<number> => {
          if (depth > 8) {
            await writeErr("gh: alias expansion loop detected\n");
            return 1;
          }
          const { command, subArgs, version, help } = normalizeTopLevelArgs(argsToRun);
          if (version || command === "version") {
            await writeOut(GH_VERSION_OUTPUT);
            return 0;
          }
          if (help || !command || command === "help") {
            await writeOut(GH_ROOT_HELP);
            return 0;
          }

          if (command === "co" && !(command in backend.config.aliases)) {
            return dispatch(["pr", "checkout", ...subArgs], depth + 1);
          }

          // Check alias expansion
          const aliasExpansion = backend.config.aliases[command];
          if (aliasExpansion) {
            const cleanExpansion = aliasExpansion.startsWith("!")
              ? aliasExpansion.slice(1).replace(/^gh\s+/u, "")
              : aliasExpansion;
            let expandedText = cleanExpansion;
            let usedPositionalPlaceholder = false;
            for (let i = 0; i < subArgs.length; i++) {
              const placeholder = `$${i + 1}`;
              if (expandedText.includes(placeholder)) {
                expandedText = expandedText.split(placeholder).join(subArgs[i]!);
                usedPositionalPlaceholder = true;
              }
            }
            const expandedTokens = splitAliasExpansion(expandedText);
            const nextArgs = usedPositionalPlaceholder
              ? expandedTokens
              : [...expandedTokens, ...subArgs];
            return dispatch(nextArgs, depth + 1);
          }

          const miscEnv = {
            context,
            backend,
            openssl,
            ssh,
            git: options.git,
            openBrowser: options.openBrowser,
            limits,
            readStdinText,
            writeOut,
            writeErr,
          };

          switch (command) {
            case "pr":
              return handlePrCommand(
                {
                  context,
                  backend,
                  http: options.http,
                  git: options.git,
                  openBrowser: options.openBrowser,
                  limits,
                  readStdinText,
                  writeOut,
                  writeErr,
                },
                subArgs
              );
            case "repo":
              return handleRepoCommand(
                {
                  context,
                  backend,
                  http: options.http,
                  git: options.git,
                  ssh,
                  openBrowser: options.openBrowser,
                  limits,
                  writeOut,
                  writeErr,
                },
                subArgs
              );
            case "issue":
              return handleIssueCommand(
                {
                  context,
                  backend,
                  git: options.git,
                  openBrowser: options.openBrowser,
                  limits,
                  readStdinText,
                  writeOut,
                  writeErr,
                },
                subArgs
              );
            case "api":
              return handleApiCommand(
                {
                  context,
                  backend,
                  http: options.http,
                  git: options.git,
                  limits,
                  readStdinBytes,
                  readStdinText,
                  writeOut,
                  writeErr,
                },
                subArgs
              );
            case "auth":
              return handleAuthCommand(
                {
                  limits,
                  context,
                  backend,
                  readStdinText,
                  writeOut,
                  writeErr,
                },
                subArgs
              );
            case "release":
              return handleReleaseCommand(miscEnv, subArgs);
            case "run":
              return handleRunCommand(miscEnv, subArgs);
            case "workflow":
              return handleWorkflowCommand(miscEnv, subArgs);
            case "gist":
              return handleGistCommand(miscEnv, subArgs);
            case "search":
              return handleSearchCommand(miscEnv, subArgs);
            case "label":
              return handleLabelCommand(miscEnv, subArgs);
            case "secret":
              return handleSecretCommand(miscEnv, subArgs);
            case "variable":
              return handleVariableCommand(miscEnv, subArgs);
            case "cache":
              return handleCacheCommand(miscEnv, subArgs);
            case "ssh-key":
              return handleSshKeyCommand(miscEnv, subArgs);
            case "gpg-key":
              return handleGpgKeyCommand(miscEnv, subArgs);
            case "attestation":
              return handleAttestationCommand(miscEnv, subArgs);
            case "config":
              return handleConfigCommand(miscEnv, subArgs);
            case "alias":
              return handleAliasCommand(miscEnv, subArgs);
            case "status":
              return handleStatusCommand(miscEnv, subArgs);
            case "browse":
              return handleBrowseCommand(miscEnv, subArgs);
            case "org":
              return handleOrgCommand(miscEnv, subArgs);
            case "project":
              return handleProjectCommand(miscEnv, subArgs);
            case "ruleset":
              return handleRulesetCommand(miscEnv, subArgs);
            case "extension":
            case "ext":
              return handleExtensionCommand(miscEnv, subArgs);
            case "codespace":
            case "cs":
              return handleCodespaceCommand(miscEnv, subArgs);
            case "completion": {
              const shellIdx = subArgs.findIndex((a) => a === "-s" || a === "--shell");
              const shellName = shellIdx !== -1 ? (subArgs[shellIdx + 1] ?? "bash") : "bash";
              await writeOut(`# ${shellName} completion for gh\ncomplete -W "pr repo issue api auth release run workflow gist search label secret variable cache ssh-key gpg-key attestation config alias status browse version" gh\n`);
              return 0;
            }
            default:
              await writeErr(`unknown command "${command}" for "gh"\n`);
              return 1;
          }
        };

        const exitCode = await dispatch(context.args);
        input.assertWithinLimits();
        return { exitCode };
      } catch (error) {
        context.signal.throwIfAborted();
        const message = error instanceof Error ? error.message : "gh execution failed";
        await writeErr(`gh: ${message}\n`);
        return { exitCode: 1 };
      }
    },
  };
  // The synchronous evaluator has no filesystem identity. Default state must
  // stay on the asynchronous path, which can select the VFS-owned backend.
  if (options.backend) ghBackendByExecutor.set(def.execute, {
    backend: options.backend,
    hasCustomHttp: Boolean(options.http),
    hasCustomBrowser: Boolean(options.openBrowser),
    limits,
  });
  return def;
}

interface GhExecutorMeta {
  readonly backend: GitHubBackend;
  readonly hasCustomHttp: boolean;
  readonly hasCustomBrowser: boolean;
  readonly limits: GhLimits;
}

const ghBackendByExecutor = new WeakMap<CommandDefinition["execute"], GhExecutorMeta>();

function resolveRepoSync(
  explicitRepoFlag: string | undefined,
  env: Readonly<Record<string, string>>,
  defaultHost: string,
  defaultOwner: string,
  cwd?: string,
  readFileSync?: (path: string) => Uint8Array | undefined,
): RepoCoordinates | undefined {
  try {
    if (explicitRepoFlag) {
      return parseRepoSpec(explicitRepoFlag, defaultHost, defaultOwner);
    }
    if (env.GH_REPO) {
      return parseRepoSpec(env.GH_REPO, defaultHost, defaultOwner);
    }
    const host = env.GH_HOST || defaultHost;
    if (cwd && readFileSync) {
      let current = cwd.startsWith("/") ? cwd : `/${cwd}`;
      for (let depth = 0; depth < 64; depth++) {
        const cfgBytes = readFileSync(`${current === "/" ? "" : current}/.git/config`);
        if (cfgBytes) {
          const raw = decodeUtf8(cfgBytes);
          const remotes = new Map<string, { url: string; ghResolved?: string }>();
          let sec = "";
          let sub = "";
          for (const rawLine of raw.split(/\r?\n/u)) {
            const line = rawLine.trim();
            if (!line || line.startsWith("#") || line.startsWith(";")) continue;
            const m = /^\[([a-zA-Z0-9_-]+)(?:\s+"([^"]+)")?\]$/u.exec(line);
            if (m) {
              sec = m[1]!.toLowerCase();
              sub = m[2] ?? "";
              continue;
            }
            const eq = line.indexOf("=");
            if (eq === -1) continue;
            const k = line.slice(0, eq).trim().toLowerCase();
            const v = line.slice(eq + 1).trim();
            if (sec === "remote" && sub) {
              const ex = remotes.get(sub) ?? { url: "" };
              if (k === "url") remotes.set(sub, { ...ex, url: v });
              else if (k === "gh-resolved") remotes.set(sub, { ...ex, ghResolved: v });
            }
          }
          for (const r of remotes.values()) {
            if (r.ghResolved === "base" && r.url) return parseRepoSpec(r.url, host, defaultOwner);
            if (r.ghResolved && r.ghResolved !== "base") return parseRepoSpec(r.ghResolved, host, defaultOwner);
          }
          const up = remotes.get("upstream");
          if (up?.url) return parseRepoSpec(up.url, host, defaultOwner);
          const orig = remotes.get("origin");
          if (orig?.url) return parseRepoSpec(orig.url, host, defaultOwner);
          for (const r of remotes.values()) {
            if (r.url) return parseRepoSpec(r.url, host, defaultOwner);
          }
          break;
        }
        if (current === "/") break;
        const idx = current.lastIndexOf("/");
        current = idx <= 0 ? "/" : current.slice(0, idx);
      }
    }
  } catch {
    return undefined;
  }
  return undefined;
}

function readCurrentBranchSync(
  cwd?: string,
  readFileSync?: (path: string) => Uint8Array | undefined,
): string | undefined {
  if (!cwd || !readFileSync) return undefined;
  let current = cwd.startsWith("/") ? cwd : `/${cwd}`;
  for (let depth = 0; depth < 64; depth++) {
    const headBytes = readFileSync(`${current === "/" ? "" : current}/.git/HEAD`);
    if (headBytes) {
      const head = decodeUtf8(headBytes).trim();
      const m = /^ref:\s*refs\/heads\/(.+)$/u.exec(head);
      if (m) return m[1]!;
      return "HEAD";
    }
    if (current === "/") break;
    const idx = current.lastIndexOf("/");
    current = idx <= 0 ? "/" : current.slice(0, idx);
  }
  return undefined;
}

function serializeRepoForJsonSync(repo: GhRepo): Record<string, unknown> {
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
    autoMergeAllowed: repo.autoMergeAllowed,
    deleteBranchOnMerge: repo.deleteBranchOnMerge,
    stargazerCount: repo.stargazerCount,
    forkCount: repo.forkCount,
    viewerPermission: repo.viewerPermission,
    createdAt: repo.createdAt,
    updatedAt: repo.updatedAt,
    pushedAt: repo.pushedAt,
    archivedAt: repo.isArchived ? repo.updatedAt : null,
    assignableUsers: [repo.owner],
    codeOfConduct: null,
    contactLinks: [],
    diskUsage: 128,
    fundingLinks: [],
    issueTemplates: [],
    issues: { totalCount: repo.issues.size },
    labels: Array.from(repo.labels.values()),
    languages: repo.primaryLanguage ? [{ size: 1024, node: repo.primaryLanguage }] : [],
    latestRelease: Array.from(repo.releases.values()).find((r) => r.isLatest) ?? null,
    licenseInfo: null,
    mentionableUsers: [repo.owner],
    milestones: Array.from(repo.milestones.values()),
    mirrorUrl: null,
    openGraphImageUrl: `${repo.url}/opengraph.png`,
    projects: [],
    projectsV2: [],
    pullRequestTemplates: [],
    pullRequests: { totalCount: repo.pullRequests.size },
    rebates: [],
    securityPolicyUrl: null,
    templateRepository: null,
    updatedAt2: repo.updatedAt,
    usesCustomOpenGraphImage: false,
    viewerCanAdminister: true,
    viewerCanCreateProjects: true,
    viewerCanSubscribe: true,
    viewerHasStarred: false,
    viewerPossibleCommitEmails: [`${repo.owner.login}@github.com`],
    viewerSubscription: "SUBSCRIBED",
    watchers: { totalCount: 1 },
  };
}

function serializeIssueForJsonSync(issue: GhIssue): Record<string, unknown> {
  return {
    ...issue,
    id: `I_${issue.number}`,
    closed: issue.state === "CLOSED",
    projectCards: [],
    reactionGroups: [],
  };
}

function serializePrForJsonSync(pr: GhPullRequest): Record<string, unknown> {
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

export function evalSyncGh(
  execFn: CommandDefinition["execute"],
  rawArgs: readonly string[],
  env: Readonly<Record<string, string>>,
  cwd?: string,
  readFileSync?: (path: string) => Uint8Array | undefined,
): string | undefined {
  const meta = ghBackendByExecutor.get(execFn);
  // File reads need the invocation budget supplied by execute().
  if (!meta || readFileSync) return undefined;
  const { backend, hasCustomHttp, limits } = meta;

  let argsToRun: readonly string[] = rawArgs;
  for (let depth = 0; depth <= 8; depth++) {
    const { command, subArgs, version, help } = normalizeTopLevelArgs(argsToRun);
    if (version || command === "version") return GH_VERSION_OUTPUT;
    if (help || !command || command === "help") return GH_ROOT_HELP;
    const aliasExpansion = backend.config.aliases[command];
    if (aliasExpansion !== undefined) {
      if (aliasExpansion.startsWith("!")) return undefined;
      argsToRun = [...splitAliasExpansion(aliasExpansion), ...subArgs];
      continue;
    }

    if (command === "completion") {
      const shellIdx = subArgs.findIndex((a) => a === "-s" || a === "--shell");
      const shellName = shellIdx !== -1 ? (subArgs[shellIdx + 1] ?? "bash") : "bash";
      return `# ${shellName} completion for gh\ncomplete -W "pr repo issue api auth release run workflow gist search label secret variable cache ssh-key gpg-key attestation config alias status browse version" gh\n`;
    }

    if (command === "config") {
      const sub = subArgs[0] ?? "list";
      const rest = subArgs.slice(1);
      const parsed = parseCommandArgs(rest, [{ short: "h", long: "host", type: "string" }]);
      const map: Record<string, keyof typeof backend.config> = {
        git_protocol: "gitProtocol",
        editor: "editor",
        prompt: "prompt",
        pager: "pager",
        http_unix_socket: "httpUnixSocket",
        browser: "browser",
      };
      if (sub === "list") {
        return [
          `git_protocol=${backend.config.gitProtocol}`,
          `editor=${backend.config.editor}`,
          `prompt=${backend.config.prompt}`,
          `pager=${backend.config.pager}`,
          `http_unix_socket=${backend.config.httpUnixSocket}`,
          `browser=${backend.config.browser}`,
          "",
        ].join("\n");
      }
      if (sub === "get") {
        const key = parsed.positionals[0] ?? "";
        const prop = map[key];
        if (!prop) return undefined;
        return `${String(backend.config[prop])}\n`;
      }
      if (sub === "set") {
        const key = parsed.positionals[0] ?? "";
        const val = parsed.positionals[1] ?? "";
        const prop = map[key];
        if (!prop) return undefined;
        (backend.config as unknown as Record<string, string>)[prop] = val;
        return "";
      }
      if (sub === "clear-cache") {
        return "✓ Cleared the cache\n";
      }
      return undefined;
    }

    if (command === "alias") {
      const sub = subArgs[0] ?? "list";
      const rest = subArgs.slice(1);
      const parsed = parseCommandArgs(rest, [
        { short: "s", long: "shell", type: "boolean" },
        { long: "all", type: "boolean" },
      ]);
      if (sub === "list" || sub === "ls") {
        const entries = Object.entries(backend.config.aliases);
        return entries.map(([k, v]) => `${k}: ${v}`).join("\n") + (entries.length > 0 ? "\n" : "");
      }
      if (sub === "set") {
        const name = parsed.positionals[0];
        const expansion = parsed.positionals[1];
        if (!name || !expansion) return undefined;
        backend.config.aliases[name] = getBoolFlag(parsed, "shell") ? `!${expansion}` : expansion;
        return `✓ Added alias for ${name}: ${backend.config.aliases[name]}\n`;
      }
      if (sub === "delete") {
        if (getBoolFlag(parsed, "all")) {
          backend.config.aliases = {};
          return "✓ Deleted all aliases\n";
        }
        const name = parsed.positionals[0] ?? "";
        if (!name) return undefined;
        delete backend.config.aliases[name];
        return `✓ Deleted alias ${name}\n`;
      }
      return undefined;
    }

    if (command === "auth") {
      const sub = subArgs[0];
      const rest = subArgs.slice(1);
      if (sub === "token" && rest.length === 0) {
        const envToken = env.GH_TOKEN ?? env.GITHUB_TOKEN;
        if (envToken) return `${envToken}\n`;
        const entries = backend.config.hosts[backend.defaultHost] ?? [];
        const active = entries.find((e) => e.active) ?? entries[0];
        if (!active) return undefined;
        return `${active.oauthToken}\n`;
      }
      if (sub === "status") {
        let hostFilter: string | undefined;
        let showToken = false;
        let activeOnly = false;
        for (let i = 0; i < rest.length; i++) {
          const a = rest[i]!;
          if (a === "-h" || a === "--hostname") hostFilter = rest[++i];
          else if (a === "-t" || a === "--show-token") showToken = true;
          else if (a === "-a" || a === "--active") activeOnly = true;
          else return undefined;
        }
        const hosts = hostFilter ? [hostFilter] : Object.keys(backend.config.hosts);
        const lines: string[] = [];
        for (const host of hosts) {
          const entries = (backend.config.hosts[host] ?? []).filter((e) => !activeOnly || e.active);
          if (entries.length === 0) continue;
          lines.push(host);
          for (const entry of entries) {
            const envToken = env.GH_TOKEN ?? env.GITHUB_TOKEN;
            const effectiveToken = envToken ?? entry.oauthToken;
            const maskedToken = showToken
              ? effectiveToken
              : `${effectiveToken.slice(0, 4)}${"*".repeat(Math.max(4, effectiveToken.length - 4))}`;
            lines.push(
              `  ✓ Logged in to ${host} account ${entry.user} (${envToken ? "GH_TOKEN" : "keyring"})`
            );
            lines.push(`  - Active account: ${entry.active}`);
            lines.push(`  - Git operations protocol: ${entry.gitProtocol}`);
            lines.push(`  - Token: ${maskedToken}`);
            lines.push(`  - Token scopes: '${entry.scopes.join("', '")}'`);
          }
        }
        if (lines.length === 0) return undefined;
        return lines.join("\n") + "\n";
      }
      return undefined;
    }

    if (command === "repo") {
      const sub = subArgs[0];
      const rest = subArgs.slice(1);
      if (sub === "view") {
        const parsed = parseCommandArgs(rest, [{ short: "b", long: "branch", type: "string" }]);
        if (parsed.help || getBoolFlag(parsed, "web")) return undefined;
        const coords = resolveRepoSync(
          parsed.positionals[0] ?? parsed.repoFlag,
          env,
          backend.defaultHost,
          backend.getActiveUser(),
          cwd,
          readFileSync
        );
        if (!coords) return undefined;
        const repo = backend.getOrCreateRepo(coords.owner, coords.name);
        const formatted = formatCommandOutputSync({
          data: serializeRepoForJsonSync(repo),
          availableFields: REPO_JSON_FIELDS,
          jsonFlag: getStringFlag(parsed, "json"),
          jqFlag: getStringFlag(parsed, "jq"),
          templateFlag: getStringFlag(parsed, "template"),
        });
        if (formatted) return formatted.handled ? formatted.output : undefined;
        const targetBranch = getStringFlag(parsed, "branch") ?? repo.defaultBranchRef.name;
        const files = repo.branchFiles.get(targetBranch) ?? repo.branchFiles.get(repo.defaultBranchRef.name) ?? {};
        const readme = files["README.md"] ?? files["readme.md"] ?? files["README"] ?? "No README provided.";
        return [
          `${repo.nameWithOwner}`,
          repo.description || "No description provided",
          "",
          readme.trim(),
          "",
          `View this repository on GitHub: ${repo.url}`,
          "",
        ].join("\n");
      }

      if ((sub === "create" || sub === "new") && !hasCustomHttp) {
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
        const parsed = parseCommandArgs(rest, schemas);
        if (parsed.help || getStringFlag(parsed, "source") || getBoolFlag(parsed, "clone")) {
          return undefined;
        }
        const rawName = parsed.positionals[0] ?? "new-repo";
        let coords: RepoCoordinates;
        try {
          coords = parseRepoSpec(rawName, backend.defaultHost, backend.getActiveUser());
        } catch {
          return undefined;
        }
        if (backend.getRepo(coords.owner, coords.name)) return undefined;
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
          Object.assign(initialFiles, tmplRepo.branchFiles.get(tmplRepo.defaultBranchRef.name) ?? {});
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
        const repo = backend.ensureRepo(coords.owner, coords.name, {
          description: getStringFlag(parsed, "description") ?? "",
          homepageUrl: getStringFlag(parsed, "homepage") ?? "",
          visibility,
          files: initialFiles,
        });
        if (getBoolFlag(parsed, "disable-issues")) repo.hasIssuesEnabled = false;
        if (getBoolFlag(parsed, "disable-wiki")) repo.hasWikiEnabled = false;
        return `${repo.url}\n`;
      }

      if (sub === "list" || sub === "ls") {
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
        const parsed = parseCommandArgs(rest, schemas);
        if (parsed.help) return undefined;
        const ownerFilter = parsed.positionals[0]?.toLowerCase();
        const limit = Math.min(getIntFlag(parsed, "limit", 30), limits.maxItems);
        const visFlag = getStringFlag(parsed, "visibility")?.toUpperCase();
        const langFlag = getStringFlag(parsed, "language")?.toLowerCase();
        const topicFlags = getStringArrayFlag(parsed, "topic").map((t) => t.toLowerCase());
        let repos = Array.from(backend.repos.values()).filter((r) => {
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
        const formatted = formatCommandOutputSync({
          data: repos.map((r) => serializeRepoForJsonSync(r)),
          availableFields: REPO_JSON_FIELDS,
          jsonFlag: getStringFlag(parsed, "json"),
          jqFlag: getStringFlag(parsed, "jq"),
          templateFlag: getStringFlag(parsed, "template"),
        });
        if (formatted) return formatted.handled ? formatted.output : undefined;
        const lines = repos.map((r) => {
          const info = [
            r.visibility.toLowerCase(),
            ...(r.isFork ? ["fork"] : []),
            ...(r.isArchived ? ["archived"] : []),
          ].join(", ");
          return `${r.nameWithOwner}\t${r.description}\t${info}\t${r.pushedAt}`;
        });
        return lines.join("\n") + (lines.length > 0 ? "\n" : "");
      }
      return undefined;
    }

    if (command === "issue") {
      const sub = subArgs[0];
      const rest = subArgs.slice(1);
      if (sub === "create" || sub === "new") {
        const schemas: FlagSchema[] = [
          { short: "t", long: "title", type: "string" },
          { short: "b", long: "body", type: "string" },
          { short: "F", long: "body-file", type: "string" },
          { short: "l", long: "label", type: "string[]" },
          { short: "a", long: "assignee", type: "string[]" },
          { short: "m", long: "milestone", type: "string" },
          { short: "p", long: "project", type: "string" },
        ];
        const parsed = parseCommandArgs(rest, schemas);
        if (parsed.help || getStringFlag(parsed, "body-file") !== undefined) return undefined;
        const coords = resolveRepoSync(parsed.repoFlag, env, backend.defaultHost, backend.getActiveUser(), cwd, readFileSync);
        if (!coords) return undefined;
        const repo = backend.getOrCreateRepo(coords.owner, coords.name);
        const issue = backend.createIssue(repo, {
          title: getStringFlag(parsed, "title") ?? "New issue",
          body: getStringFlag(parsed, "body") ?? "",
          labels: getStringArrayFlag(parsed, "label"),
          assignees: getStringArrayFlag(parsed, "assignee"),
          milestone: getStringFlag(parsed, "milestone"),
          project: getStringFlag(parsed, "project"),
        });
        return `${issue.url}\n`;
      }

      if (sub === "list" || sub === "ls") {
        const schemas: FlagSchema[] = [
          { short: "s", long: "state", type: "string" },
          { short: "l", long: "label", type: "string[]" },
          { short: "A", long: "author", type: "string" },
          { short: "a", long: "assignee", type: "string" },
          { short: "S", long: "search", type: "string" },
          { short: "L", long: "limit", type: "string" },
        ];
        const parsed = parseCommandArgs(rest, schemas);
        if (parsed.help) return undefined;
        const coords = resolveRepoSync(parsed.repoFlag, env, backend.defaultHost, backend.getActiveUser(), cwd, readFileSync);
        if (!coords) return undefined;
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
          if (assigneeFilter && !iss.assignees.some((a) => a.login.toLowerCase() === assigneeFilter.toLowerCase())) return false;
          for (const lbl of labelFilters) {
            if (!iss.labels.some((l) => l.name.toLowerCase() === lbl)) return false;
          }
          if (searchFilter && !`${iss.title} ${iss.body}`.toLowerCase().includes(searchFilter)) return false;
          return true;
        });
        items = items.slice(0, limit);
        const formatted = formatCommandOutputSync({
          data: items.map((i) => serializeIssueForJsonSync(i)),
          availableFields: ISSUE_JSON_FIELDS,
          jsonFlag: getStringFlag(parsed, "json"),
          jqFlag: getStringFlag(parsed, "jq"),
          templateFlag: getStringFlag(parsed, "template"),
        });
        if (formatted) return formatted.handled ? formatted.output : undefined;
        const lines = items.map(
          (i) => `${i.number}\t${i.state}\t${i.title}\t${i.labels.map((l) => l.name).join(", ")}\t${i.updatedAt}`
        );
        return lines.join("\n") + (lines.length > 0 ? "\n" : "");
      }

      if (sub === "view") {
        const parsed = parseCommandArgs(rest, [{ short: "c", long: "comments", type: "boolean" }]);
        if (parsed.help || getBoolFlag(parsed, "web")) return undefined;
        const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
        const coords = resolveRepoSync(repoOverride, env, backend.defaultHost, backend.getActiveUser(), cwd, readFileSync);
        if (!coords) return undefined;
        const repo = backend.getOrCreateRepo(coords.owner, coords.name);
        let issue: GhIssue;
        try {
          issue = backend.resolveIssue(repo, selector ?? "1");
        } catch {
          return undefined;
        }
        const formatted = formatCommandOutputSync({
          data: serializeIssueForJsonSync(issue),
          availableFields: ISSUE_JSON_FIELDS,
          jsonFlag: getStringFlag(parsed, "json"),
          jqFlag: getStringFlag(parsed, "jq"),
          templateFlag: getStringFlag(parsed, "template"),
        });
        if (formatted) return formatted.handled ? formatted.output : undefined;
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
        return lines.join("\n") + "\n";
      }

      if (sub === "close" || sub === "reopen") {
        const parsed = parseCommandArgs(rest, [
          { short: "c", long: "comment", type: "string" },
          { short: "r", long: "reason", type: "string" },
        ]);
        const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
        const coords = resolveRepoSync(repoOverride, env, backend.defaultHost, backend.getActiveUser(), cwd, readFileSync);
        if (!coords) return undefined;
        const repo = backend.getOrCreateRepo(coords.owner, coords.name);
        let issue: GhIssue;
        try {
          issue = backend.resolveIssue(repo, selector ?? "1");
        } catch {
          return undefined;
        }
        const comment = getStringFlag(parsed, "comment");
        if (comment) {
          const timestamp = backend.isoNow();
          issue.comments.push({
            id: backend.nextId(),
            author: { login: backend.getActiveUser() },
            body: comment,
            createdAt: timestamp,
            updatedAt: timestamp,
            url: `${issue.url}#issuecomment-${backend.nextId()}`,
          });
        }
        if (sub === "close") {
          issue.state = "CLOSED";
          issue.closedAt = backend.isoNow();
          issue.stateReason = getStringFlag(parsed, "reason")?.toUpperCase() === "NOT_PLANNED" ? "NOT_PLANNED" : "COMPLETED";
          return `✓ Closed issue #${issue.number} (${issue.title})\n`;
        }
        issue.state = "OPEN";
        issue.closedAt = null;
        issue.stateReason = "REOPENED";
        return `✓ Reopened issue #${issue.number} (${issue.title})\n`;
      }

      if (sub === "comment") {
        const parsed = parseCommandArgs(rest, [
          { short: "b", long: "body", type: "string" },
          { short: "F", long: "body-file", type: "string" },
          { long: "edit-last", type: "boolean" },
          { long: "delete-last", type: "boolean" },
          { long: "create-if-none", type: "boolean" },
        ]);
        if (["body-file", "edit-last", "delete-last", "create-if-none"].some(flag => parsed.flags.has(flag))) return undefined;
        const body = getStringFlag(parsed, "body");
        if (body === undefined) return undefined;
        const { repoOverride, selector } = extractRepoAndSelectorFromIssueArg(parsed.positionals[0], parsed.repoFlag);
        const coords = resolveRepoSync(repoOverride, env, backend.defaultHost, backend.getActiveUser(), cwd, readFileSync);
        if (!coords) return undefined;
        const repo = backend.getOrCreateRepo(coords.owner, coords.name);
        let issue: GhIssue;
        try {
          issue = backend.resolveIssue(repo, selector ?? "1");
        } catch {
          return undefined;
        }
        const timestamp = backend.isoNow();
        const commentObj = {
          id: backend.nextId(),
          author: { login: backend.getActiveUser() },
          body,
          createdAt: timestamp,
          updatedAt: timestamp,
          url: `${issue.url}#issuecomment-${backend.nextId()}`,
        };
        issue.comments.push(commentObj);
        return `${commentObj.url}\n`;
      }
      return undefined;
    }

    if (command === "pr") {
      const sub = subArgs[0];
      const rest = subArgs.slice(1);
      if ((sub === "list" || sub === "ls") && !hasCustomHttp) {
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
        const parsed = parseCommandArgs(rest, schemas);
        if (parsed.help) return undefined;
        const coords = resolveRepoSync(parsed.repoFlag, env, backend.defaultHost, backend.getActiveUser(), cwd, readFileSync);
        if (!coords) return undefined;
        const repo = backend.getOrCreateRepo(coords.owner, coords.name);
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
        if (searchFilter) return undefined;
        const limit = Math.min(getIntFlag(parsed, "limit", 30), limits.maxItems);
        let items = Array.from(repo.pullRequests.values()).sort((a, b) => b.number - a.number);
        items = items.filter((pr) => {
          if (stateFilter === "open" && pr.state !== "OPEN") return false;
          if (stateFilter === "closed" && pr.state !== "CLOSED" && pr.state !== "MERGED") return false;
          if (stateFilter === "merged" && pr.state !== "MERGED") return false;
          if (baseFilter && pr.baseRefName !== baseFilter) return false;
          if (headFilter && pr.headRefName !== headFilter) return false;
          if (draftFlag !== undefined && pr.isDraft !== draftFlag) return false;
          if (authorFilter && pr.author.login.toLowerCase() !== authorFilter.toLowerCase()) return false;
          if (assigneeFilter && !pr.assignees.some((a) => a.login.toLowerCase() === assigneeFilter.toLowerCase())) return false;
          for (const lbl of labelFilters) {
            if (!pr.labels.some((l) => l.name.toLowerCase() === lbl)) return false;
          }
          return true;
        });
        items = items.slice(0, limit);
        const formatted = formatCommandOutputSync({
          data: items.map((p) => serializePrForJsonSync(p)),
          availableFields: PR_JSON_FIELDS,
          jsonFlag: getStringFlag(parsed, "json"),
          jqFlag: getStringFlag(parsed, "jq"),
          templateFlag: getStringFlag(parsed, "template"),
        });
        if (formatted) return formatted.handled ? formatted.output : undefined;
        if (items.length === 0) return "";
        const lines = items.map(
          (pr) => `${pr.number}\t${pr.title}\t${pr.headRefName}\t${pr.isDraft ? "DRAFT" : pr.state}`
        );
        return lines.join("\n") + "\n";
      }

      if (sub === "view") {
        const parsed = parseCommandArgs(rest, [{ short: "c", long: "comments", type: "boolean" }]);
        if (parsed.help || getBoolFlag(parsed, "web")) return undefined;
        const coords = resolveRepoSync(parsed.repoFlag, env, backend.defaultHost, backend.getActiveUser(), cwd, readFileSync);
        if (!coords) return undefined;
        const repo = backend.getOrCreateRepo(coords.owner, coords.name);
        const currentBranch = readCurrentBranchSync(cwd, readFileSync);
        let pr: GhPullRequest;
        try {
          pr = backend.resolvePullRequest(repo, parsed.positionals[0], currentBranch);
        } catch {
          return undefined;
        }
        const formatted = formatCommandOutputSync({
          data: serializePrForJsonSync(pr),
          availableFields: PR_JSON_FIELDS,
          jsonFlag: getStringFlag(parsed, "json"),
          jqFlag: getStringFlag(parsed, "jq"),
          templateFlag: getStringFlag(parsed, "template"),
        });
        if (formatted) return formatted.handled ? formatted.output : undefined;
        const statusBadge = pr.isDraft ? "DRAFT" : pr.state;
        const outLines: string[] = [
          `${pr.title} #${pr.number}`,
          `${statusBadge} • ${pr.author.login} wants to merge ${pr.commits.length} commit${pr.commits.length === 1 ? "" : "s"} into ${pr.baseRefName} from ${pr.headRefName} • +${pr.additions} -${pr.deletions}`,
        ];
        if (pr.labels.length > 0) outLines.push(`Labels: ${pr.labels.map((l) => l.name).join(", ")}`);
        if (pr.assignees.length > 0) outLines.push(`Assignees: ${pr.assignees.map((a) => a.login).join(", ")}`);
        if (pr.reviewRequests.length > 0 || pr.reviews.length > 0) {
          const reviewerNames = Array.from(
            new Set([
              ...pr.reviewRequests.map((r) => r.login),
              ...pr.reviews.map((r) => `${r.author.login} (${r.state})`),
            ])
          );
          outLines.push(`Reviewers: ${reviewerNames.join(", ")}`);
        }
        if (pr.milestone) outLines.push(`Milestone: ${pr.milestone.title}`);
        outLines.push("", pr.body || "No description provided.", "");
        if (getBoolFlag(parsed, "comments") && pr.comments.length > 0) {
          outLines.push("--- Comments ---");
          for (const c of pr.comments) {
            outLines.push(`${c.author.login} (${c.createdAt}):\n${c.body}\n`);
          }
        }
        outLines.push(`View this pull request on GitHub: ${pr.url}`);
        return outLines.join("\n") + "\n";
      }

      if (sub === "create" || sub === "new") {
        const schemas: FlagSchema[] = [
          { short: "t", long: "title", type: "string" },
          { short: "b", long: "body", type: "string" },
          { short: "F", long: "body-file", type: "string" },
          { short: "B", long: "base", type: "string" },
          { short: "H", long: "head", type: "string" },
          { short: "d", long: "draft", type: "boolean" },
          { short: "l", long: "label", type: "string[]" },
          { short: "a", long: "assignee", type: "string[]" },
          { short: "r", long: "reviewer", type: "string[]" },
          { short: "m", long: "milestone", type: "string" },
          { short: "p", long: "project", type: "string" },
          { long: "no-maintainer-edit", type: "boolean" },
        ];
        const parsed = parseCommandArgs(rest, schemas);
        if (parsed.help || getBoolFlag(parsed, "web") || getStringFlag(parsed, "body-file") !== undefined) {
          return undefined;
        }
        const title = getStringFlag(parsed, "title");
        const rawHead = getStringFlag(parsed, "head") ?? readCurrentBranchSync(cwd, readFileSync);
        if (!title || !rawHead) return undefined;
        const coords = resolveRepoSync(parsed.repoFlag, env, backend.defaultHost, backend.getActiveUser(), cwd, readFileSync);
        if (!coords) return undefined;
        const repo = backend.getOrCreateRepo(coords.owner, coords.name);
        const headOwner = rawHead.includes(":") ? rawHead.split(":")[0]! : repo.owner.login;
        const headBranch = rawHead.includes(":") ? rawHead.split(":")[1]! : rawHead;
        const baseBranch = getStringFlag(parsed, "base") ?? repo.defaultBranchRef.name;
        if (headBranch === baseBranch && headOwner.toLowerCase() === repo.owner.login.toLowerCase()) return undefined;
        const existingOpen = Array.from(repo.pullRequests.values()).find(
          (p) =>
            p.state === "OPEN" &&
            p.headRefName === headBranch &&
            p.baseRefName === baseBranch &&
            p.headRepositoryOwner.login.toLowerCase() === headOwner.toLowerCase()
        );
        if (existingOpen) return undefined;
        const pr = backend.createPullRequest(repo, {
          title,
          body: getStringFlag(parsed, "body") ?? "",
          headRefName: headBranch,
          baseRefName: baseBranch,
          isDraft: getBoolFlag(parsed, "draft"),
          labels: getStringArrayFlag(parsed, "label"),
          assignees: getStringArrayFlag(parsed, "assignee"),
          reviewers: getStringArrayFlag(parsed, "reviewer"),
          milestone: getStringFlag(parsed, "milestone"),
          project: getStringFlag(parsed, "project"),
          maintainerCanModify: !getBoolFlag(parsed, "no-maintainer-edit"),
          headOwner,
        });
        return `${pr.url}\n`;
      }
      return undefined;
    }

    if (command === "release") {
      const sub = subArgs[0];
      const rest = subArgs.slice(1);
      const coords = resolveRepoSync(
        parseCommandArgs(rest, []).repoFlag,
        env,
        backend.defaultHost,
        backend.getActiveUser(),
        cwd,
        readFileSync
      );
      if (!coords) return undefined;
      const repo = backend.getOrCreateRepo(coords.owner, coords.name);
      const serializeRelease = (r: GhRelease) => ({
        ...r,
        databaseId: r.id,
        apiUrl: `https://api.github.com/repos/${repo.nameWithOwner}/releases/${r.id}`,
        tarballUrl: `${repo.url}/archive/refs/tags/${r.tagName}.tar.gz`,
        zipballUrl: `${repo.url}/archive/refs/tags/${r.tagName}.zip`,
        uploadUrl: `https://uploads.github.com/repos/${repo.nameWithOwner}/releases/${r.id}/assets`,
        isImmutable: false,
        assets: r.assets.map((a) => ({
          id: a.id,
          name: a.name,
          label: a.label,
          size: a.size,
          contentType: a.contentType,
          downloadCount: a.downloadCount,
          createdAt: a.createdAt,
          updatedAt: a.updatedAt,
          url: a.url,
        })),
      });

      if (sub === "create") {
        const schemas: FlagSchema[] = [
          { short: "t", long: "title", type: "string" },
          { short: "n", long: "notes", type: "string" },
          { short: "F", long: "notes-file", type: "string" },
          { long: "generate-notes", type: "boolean" },
          { short: "d", long: "draft", type: "boolean" },
          { short: "p", long: "prerelease", type: "boolean" },
          { long: "target", type: "string" },
          { long: "latest", type: "boolean" },
        ];
        const parsed = parseCommandArgs(rest, schemas);
        const tagName = parsed.positionals[0];
        if (!tagName || parsed.positionals.length > 1 || getStringFlag(parsed, "notes-file") !== undefined) {
          return undefined;
        }
        let body = getStringFlag(parsed, "notes") ?? "";
        if (!body && getBoolFlag(parsed, "generate-notes")) {
          const prs = Array.from(repo.pullRequests.values());
          body =
            "## What's Changed\n" +
            (prs.length > 0
              ? prs.map((p) => `* ${p.title} by @${p.author.login} in #${p.number}`).join("\n")
              : `* Release ${tagName}`);
        }
        const ts = backend.isoNow();
        const isDraft = getBoolFlag(parsed, "draft");
        const isPrerelease = getBoolFlag(parsed, "prerelease");
        const isLatest = parsed.flags.has("latest")
          ? getBoolFlag(parsed, "latest")
          : !isDraft && !isPrerelease;
        if (isLatest) {
          for (const existing of repo.releases.values()) existing.isLatest = false;
        }
        const rel: GhRelease = {
          id: backend.nextId(),
          tagName,
          name: getStringFlag(parsed, "title") ?? tagName,
          body,
          isDraft,
          isPrerelease,
          isLatest,
          targetCommitish: getStringFlag(parsed, "target") ?? repo.defaultBranchRef.name,
          author: { login: backend.getActiveUser() },
          createdAt: ts,
          publishedAt: ts,
          url: `${repo.url}/releases/tag/${tagName}`,
          assets: [],
        };
        repo.releases.set(tagName, rel);
        return `${rel.url}\n`;
      }

      if (sub === "list" || sub === "ls") {
        const parsed = parseCommandArgs(rest, [
          { short: "L", long: "limit", type: "string" },
          { long: "exclude-drafts", type: "boolean" },
          { long: "exclude-pre-releases", type: "boolean" },
        ]);
        let list = Array.from(repo.releases.values());
        if (getBoolFlag(parsed, "exclude-drafts")) list = list.filter((r) => !r.isDraft);
        if (getBoolFlag(parsed, "exclude-pre-releases")) list = list.filter((r) => !r.isPrerelease);
        list = list.slice(0, getIntFlag(parsed, "limit", 30));
        const formatted = formatCommandOutputSync({
          data: list.map(serializeRelease),
          availableFields: RELEASE_JSON_FIELDS,
          jsonFlag: getStringFlag(parsed, "json"),
          jqFlag: getStringFlag(parsed, "jq"),
          templateFlag: getStringFlag(parsed, "template"),
        });
        if (formatted) return formatted.handled ? formatted.output : undefined;
        const lines = list.map((r) => {
          const type = r.isDraft ? "Draft" : r.isPrerelease ? "Pre-release" : r.isLatest ? "Latest" : "";
          return `${r.name}\t${type}\t${r.tagName}\t${r.publishedAt}`;
        });
        return lines.join("\n") + (lines.length > 0 ? "\n" : "");
      }

      if (sub === "view") {
        const parsed = parseCommandArgs(rest, []);
        if (getBoolFlag(parsed, "web")) return undefined;
        const tag = parsed.positionals[0];
        const rel = tag
          ? repo.releases.get(tag)
          : (Array.from(repo.releases.values()).find((r) => r.isLatest) ??
            Array.from(repo.releases.values())[0]);
        if (!rel) return undefined;
        const formatted = formatCommandOutputSync({
          data: serializeRelease(rel),
          availableFields: RELEASE_JSON_FIELDS,
          jsonFlag: getStringFlag(parsed, "json"),
          jqFlag: getStringFlag(parsed, "jq"),
          templateFlag: getStringFlag(parsed, "template"),
        });
        if (formatted) return formatted.handled ? formatted.output : undefined;
        return [
          `${rel.tagName}`,
          `${rel.name}`,
          rel.body || "No release notes.",
          ...(rel.assets.length > 0
            ? ["", "Assets:", ...rel.assets.map((a) => `  ${a.name}\t${a.size} B`)]
            : []),
          "",
          `View on GitHub: ${rel.url}`,
          "",
        ].join("\n");
      }
      return undefined;
    }

    if (command === "label") {
      const sub = subArgs[0] ?? "list";
      const rest = subArgs.slice(1);
      const parsed = parseCommandArgs(rest, [
        { short: "c", long: "color", type: "string" },
        { short: "d", long: "description", type: "string" },
        { short: "n", long: "name", type: "string" },
        { short: "f", long: "force", type: "boolean" },
      ]);
      const coords = resolveRepoSync(parsed.repoFlag, env, backend.defaultHost, backend.getActiveUser(), cwd, readFileSync);
      if (!coords) return undefined;
      const repo = backend.getOrCreateRepo(coords.owner, coords.name);
      if (sub === "list" || sub === "ls") {
        const labels = Array.from(repo.labels.values());
        const formatted = formatCommandOutputSync({
          data: labels,
          availableFields: ["id", "name", "color", "description", "isDefault"],
          jsonFlag: getStringFlag(parsed, "json"),
          jqFlag: getStringFlag(parsed, "jq"),
          templateFlag: getStringFlag(parsed, "template"),
        });
        if (formatted) return formatted.handled ? formatted.output : undefined;
        return (
          labels.map((l) => `${l.name}\t${l.description}\t#${l.color}`).join("\n") +
          (labels.length > 0 ? "\n" : "")
        );
      }
      if (sub === "create") {
        const name = parsed.positionals[0];
        if (!name) return undefined;
        if (repo.labels.has(name.toLowerCase()) && !getBoolFlag(parsed, "force")) return undefined;
        const lbl: GhLabel = {
          id: backend.nextId(),
          name,
          color: (getStringFlag(parsed, "color") ?? "ededed").replace(/^#/u, ""),
          description: getStringFlag(parsed, "description") ?? "",
        };
        repo.labels.set(name.toLowerCase(), lbl);
        return `✓ Created label "${name}" in ${repo.nameWithOwner}\n`;
      }
      if (sub === "delete") {
        const name = parsed.positionals[0];
        if (!name || !repo.labels.has(name.toLowerCase())) return undefined;
        repo.labels.delete(name.toLowerCase());
        return `✓ Deleted label "${name}" from ${repo.nameWithOwner}\n`;
      }
      return undefined;
    }

    if (command === "variable") {
      const sub = subArgs[0] ?? "list";
      const rest = subArgs.slice(1);
      const parsed = parseCommandArgs(rest, [
        { short: "b", long: "body", type: "string" },
        { short: "e", long: "env", type: "string" },
        { short: "o", long: "org", type: "string" },
      ]);
      const org = getStringFlag(parsed, "org");
      let targetMap: Map<string, GhVariable>;
      if (org) {
        targetMap = backend.orgVariables;
      } else {
        const coords = resolveRepoSync(parsed.repoFlag, env, backend.defaultHost, backend.getActiveUser(), cwd, readFileSync);
        if (!coords) return undefined;
        targetMap = backend.getOrCreateRepo(coords.owner, coords.name).variables;
      }
      if (sub === "list" || sub === "ls") {
        const list = Array.from(targetMap.values());
        const formatted = formatCommandOutputSync({
          data: list,
          availableFields: ["name", "value", "createdAt", "updatedAt"],
          jsonFlag: getStringFlag(parsed, "json"),
          jqFlag: getStringFlag(parsed, "jq"),
          templateFlag: getStringFlag(parsed, "template"),
        });
        if (formatted) return formatted.handled ? formatted.output : undefined;
        return (
          list.map((v) => `${v.name}\t${v.value}\t${v.updatedAt}`).join("\n") +
          (list.length > 0 ? "\n" : "")
        );
      }
      if (sub === "get") {
        const name = parsed.positionals[0] ?? "";
        const found = targetMap.get(name);
        if (!found) return undefined;
        return `${found.value}\n`;
      }
      if (sub === "set") {
        const name = parsed.positionals[0];
        const value = getStringFlag(parsed, "body") ?? parsed.positionals[1];
        if (!name || value === undefined) return undefined;
        const ts = backend.isoNow();
        targetMap.set(name, {
          name,
          value,
          createdAt: ts,
          updatedAt: ts,
          environment: getStringFlag(parsed, "env"),
          org,
        });
        return `✓ Set Actions variable ${name}\n`;
      }
      if (sub === "delete") {
        const name = parsed.positionals[0] ?? "";
        if (!name) return undefined;
        targetMap.delete(name);
        return `✓ Deleted Actions variable ${name}\n`;
      }
      return undefined;
    }

    if (command === "api" && !hasCustomHttp) {
      const schemas: FlagSchema[] = [
        { short: "X", long: "method", type: "string" },
        { short: "f", long: "raw-field", type: "string[]" },
        { short: "F", long: "field", type: "string[]" },
        { short: "H", long: "header", type: "string[]" },
        { long: "input", type: "string" },
        { short: "i", long: "include", type: "boolean" },
        { long: "paginate", type: "boolean" },
        { long: "slurp", type: "boolean" },
        { long: "silent", type: "boolean" },
        { long: "hostname", type: "string" },
      ];
      const parsed = parseCommandArgs(subArgs, schemas);
      if (
        parsed.help ||
        parsed.positionals.length === 0 ||
        getStringFlag(parsed, "input") !== undefined ||
        getBoolFlag(parsed, "include")
      ) {
        return undefined;
      }
      let endpoint = parsed.positionals[0]!;
      if (
        endpoint.includes(":owner") ||
        endpoint.includes(":repo") ||
        endpoint.includes(":branch") ||
        endpoint.includes("{owner}") ||
        endpoint.includes("{repo}") ||
        endpoint.includes("{branch}")
      ) {
        const coords = resolveRepoSync(parsed.repoFlag, env, backend.defaultHost, backend.getActiveUser(), cwd, readFileSync);
        const owner = coords?.owner ?? backend.getActiveUser();
        const repoName = coords?.name ?? "Hello-World";
        const branch = readCurrentBranchSync(cwd, readFileSync) ?? "main";
        endpoint = endpoint
          .replace(/:owner|\{owner\}/gu, owner)
          .replace(/:repo|\{repo\}/gu, repoName)
          .replace(/:branch|\{branch\}/gu, branch);
      }
      const rawFields = getRawStringArrayFlag(parsed, "raw-field");
      const typedFields = getRawStringArrayFlag(parsed, "field");
      const hasFields = rawFields.length > 0 || typedFields.length > 0;
      const isGraphQl = endpoint === "graphql" || endpoint === "/graphql";
      const method = (getStringFlag(parsed, "method") ?? (isGraphQl || hasFields ? "POST" : "GET")).toUpperCase();
      const payload: Record<string, unknown> = {};
      for (const item of rawFields) {
        const eq = item.indexOf("=");
        if (eq === -1) continue;
        payload[item.slice(0, eq)] = item.slice(eq + 1);
      }
      for (const item of typedFields) {
        const eq = item.indexOf("=");
        if (eq === -1) continue;
        const k = item.slice(0, eq);
        const v = item.slice(eq + 1);
        if (v.startsWith("@")) return undefined;
        payload[k] = v === "true" ? true : v === "false" ? false : v === "null" ? null : /^-?\d+$/u.test(v) ? Number.parseInt(v, 10) : v;
      }
      let data: unknown;
      if (isGraphQl) {
        const query = String(payload.query ?? "");
        const variables: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(payload)) {
          if (k !== "query" && k !== "operationName") variables[k] = v;
        }
        data = backend.evaluateGraphQl(query, variables);
      } else {
        const host = getStringFlag(parsed, "hostname") ?? env.GH_HOST ?? backend.defaultHost;
        const baseUrl = host === "github.com" ? "https://api.github.com" : `https://${host}/api/v3`;
        const fullUrl = /^https?:\/\//u.test(endpoint) ? endpoint : `${baseUrl}/${endpoint.replace(/^\/+/u, "")}`;
        const u = new URL(fullUrl);
        if (method === "GET") {
          for (const [k, v] of Object.entries(payload)) u.searchParams.set(k, String(v));
        }
        const res = backend.handleInternalHttpRequest({ url: u.toString(), method, headers: {}, body: method === "GET" ? new Uint8Array() : encodeUtf8(JSON.stringify(payload)), signal: new AbortController().signal });
        if (res.status >= 400) return undefined;
        try {
          data = JSON.parse(decodeUtf8(res.body));
        } catch {
          data = decodeUtf8(res.body);
        }
      }
      if (getBoolFlag(parsed, "silent")) return "";
      const formatted = formatCommandOutputSync({
        data,
        jqFlag: getStringFlag(parsed, "jq"),
        templateFlag: getStringFlag(parsed, "template"),
      });
      if (formatted) return formatted.handled ? formatted.output : undefined;
      return typeof data === "string" ? (data.endsWith("\n") ? data : `${data}\n`) : `${JSON.stringify(data, null, 2)}\n`;
    }

    return undefined;
  }
  return undefined;
}

export function createGhCommands(options: GhCommandsOptions = {}): readonly CommandDefinition[] {
  return [createGhCommand(options)];
}

export function ghCommands(options: GhCommandsOptions = {}): VirtualShellPlugin {
  const command = createGhCommand(options);
  return {
    name: "gh-commands",
    setup(host) {
      host.commands.register(command, { replace: options.replace ?? false });
    },
  };
}
