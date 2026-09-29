import {
  commandRuntimeIdentity,
  readBytes,
  writeBytes,
  type CommandContext,
  type CommandDefinition,
  type CommandHandler,
  type VirtualShellPlugin,
} from "safe-bash-contracts";
import { createGitHubBackend, GitHubBackend } from "./backend.js";
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
  const backend =
    options.backend ??
    createGitHubBackend({
      defaultHost: options.defaultHost,
      defaultUser: options.defaultUser,
      defaultToken: options.defaultToken,
      now: options.now,
    });
  const openssl = createDefaultOpenSslProvider(options.openssl);
  const ssh = createDefaultSshProvider(options.ssh, backend.getActiveUser());

  return {
    name: "gh",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Work seamlessly with GitHub from the command line",
    async execute(context: CommandContext) {
      context.signal.throwIfAborted();
      backend.resetUsage();

      let outputBytes = 0;
      const writeOut = async (text: string) => {
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
        const stdinChunks: Uint8Array[] = [];
        let totalIn = 0;
        for await (const chunk of readBytes(context.stdin, context.signal)) {
          totalIn += chunk.length;
          if (totalIn > limits.maxInputBytes) {
            throw new Error("gh input byte limit exceeded");
          }
          stdinChunks.push(chunk);
        }
        const stdinBytes = new Uint8Array(totalIn);
        let inOffset = 0;
        for (const chunk of stdinChunks) {
          stdinBytes.set(chunk, inOffset);
          inOffset += chunk.length;
        }
        const stdinText = decodeUtf8(stdinBytes);

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
            stdinText,
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
                  stdinText,
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
                  stdinText,
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
                  stdinBytes,
                  stdinText,
                  writeOut,
                  writeErr,
                },
                subArgs
              );
            case "auth":
              return handleAuthCommand(
                {
                  context,
                  backend,
                  stdinText,
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
        return { exitCode };
      } catch (error) {
        context.signal.throwIfAborted();
        const message = error instanceof Error ? error.message : "gh execution failed";
        await writeErr(`gh: ${message}\n`);
        return { exitCode: 1 };
      }
    },
  };
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
