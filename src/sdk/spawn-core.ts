import chalk from "chalk";
import {
  formatAgentCapabilityError,
  resolveAgentId,
  parseAgentSpecifier
} from "@poe-code/agent-defs";
import { resolveConfigModel } from "@poe-code/poe-code-config";
import { UserError } from "@poe-code/user-error";
import type { CliContainer } from "../cli/container.js";
import { ValidationError } from "../cli/errors.js";
import type { SpawnResult } from "./types.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveActiveProviderForService
} from "../cli/commands/shared.js";
import type { SpawnCommandOptions } from "../providers/spawn-options.js";
import {
  DEFAULT_SPAWN_MODE,
  type McpSpawnConfig,
  type SpawnMode
} from "@poe-code/agent-spawn";
import type { HookBridgeOptions } from "./types.js";
import type { CommandRunnerResult } from "../utils/command-checks.js";
import { resolveSpawnWorkspace } from "../workspace/resolve-spawn-workspace.js";

const REDACTED_PROMPT_ARG = "[prompt redacted]";

export interface SpawnCoreOptions {
  /** The prompt to send to the provider */
  prompt: string;
  /** Working directory or workspace locator for the service CLI */
  cwd?: string;
  /** Model identifier override */
  model?: string;
  /** Permission mode: yolo | auto | edit | read */
  mode?: SpawnMode;
  /** Additional arguments forwarded to the CLI */
  args?: string[];
  /** Environment overrides applied only to this spawned run. */
  env?: Record<string, string | undefined>;
  /** MCP servers passed at spawn time */
  mcpServers?: McpSpawnConfig;
  /** Skill references to bridge into the spawned agent for this run. */
  skills?: string[];
  /** Hooks to bridge from another agent configuration for this run. */
  hooks?: HookBridgeOptions;
  /** Resume a prior provider thread/session before sending the prompt. */
  resumeThreadId?: string;
  /** Whether prompt was read from stdin */
  useStdin?: boolean;
}

export interface SpawnCoreFlags {
  dryRun: boolean;
  verbose: boolean;
}

/**
 * Core spawn implementation used by both SDK and CLI.
 * Accepts an existing container to avoid creating a new one.
 */
export async function spawnCore(
  container: CliContainer,
  service: string,
  options: SpawnCoreOptions,
  flags: SpawnCoreFlags = { dryRun: false, verbose: false }
): Promise<SpawnResult> {
  const adapter = container.registry.get(service);
  if (!adapter) {
    throw new ValidationError(formatAgentCapabilityError({ agent: service, capability: "spawn" }));
  }

  if (options.resumeThreadId !== undefined) {
    assertUsableThreadId(options.resumeThreadId);
  }

  const mode = options.mode ?? DEFAULT_SPAWN_MODE;
  const model = await resolveConfiguredModel(container, service, options.model, {
    readOnly: flags.dryRun
  });
  const workspace = await resolveSpawnWorkspace(options.cwd, {
    baseDir: container.env.cwd,
    homeDir: container.env.homeDir,
    mode,
    resolveRemoteLocators: !flags.dryRun,
    fs: container.fs,
    exec: container.commandRunner
  });
  const cwdOverride = workspace.cwd;

  try {
    const spawnOptions: SpawnCommandOptions = {
      prompt: options.prompt,
      args: options.args,
      model,
      mode,
      env: options.env,
      mcpServers: options.mcpServers,
      skills: options.skills,
      hooks: options.hooks,
      resumeThreadId: options.resumeThreadId,
      cwd: cwdOverride,
      useStdin: options.useStdin ?? false
    };

    const commandFlags = { dryRun: flags.dryRun, assumeYes: true, verbose: flags.verbose };
    const resources = createExecutionResources(
      container,
      commandFlags,
      `spawn:${service}`,
      options.env
    );

    if (flags.dryRun) {
      const summary = formatSpawnDryRunMessage(adapter.label, spawnOptions);
      resources.logger.dryRun(summary);
      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    }

    if (typeof adapter.spawn !== "function") {
      throw new Error(`${adapter.label} does not support spawn.`);
    }

    if (spawnOptions.useStdin && !adapter.supportsStdinPrompt) {
      throw new Error(
        `${adapter.label} does not support stdin prompts. Use a different service (e.g. "codex") or pass the prompt as an argument.`
      );
    }

    const activeProvider = await resolveActiveProviderForService(container, adapter.name);
    const providerContext = buildProviderContext(container, adapter, resources, { activeProvider });

    const result = (await container.registry.invoke(adapter.name, "spawn", async (entry) => {
      if (!entry.spawn) {
        throw new Error(`${adapter.label} does not support spawn.`);
      }
      const output = await entry.spawn(providerContext, spawnOptions);
      return output as CommandRunnerResult | void;
    })) as CommandRunnerResult | void;

    if (!result) {
      return {
        stdout: "",
        stderr: "",
        exitCode: 0
      };
    }

    return {
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode
    };
  } finally {
    await workspace.cleanup?.().catch(() => undefined);
  }
}

/**
 * Agents disagree on thread id format (UUIDs, `thr_`/`ses_` prefixes), so only the
 * shapes no agent can accept are rejected here. Left unchecked, these reach the
 * agent's own `--resume` and come back as its usage text about a flag the user
 * never typed.
 */
export function assertUsableThreadId(threadId: string): void {
  if (threadId.trim().length === 0) {
    throw new UserError(
      "--resume-thread-id is empty. Pass the thread id printed at the end of the run you want to resume."
    );
  }
  if (/[\s\u0000-\u001f]/.test(threadId)) {
    throw new UserError(
      `--resume-thread-id "${threadId}" is not a thread id: it contains whitespace. ` +
        "Pass the thread id printed at the end of the run you want to resume."
    );
  }
  if (threadId.startsWith("-")) {
    throw new UserError(
      `--resume-thread-id "${threadId}" looks like a flag, not a thread id. ` +
        "Pass the thread id printed at the end of the run you want to resume."
    );
  }
}

export async function resolveConfiguredModel(
  container: Pick<CliContainer, "env" | "fs" | "registry">,
  service: string,
  model?: string,
  options: { readOnly?: boolean } = {}
): Promise<string | undefined> {
  if (model != null) {
    return model;
  }

  const { agent } = parseAgentSpecifier(service);
  const agentId = container.registry.get(service)?.name ?? resolveAgentId(agent) ?? agent;
  const configuredModel = await resolveConfigModel(
    {
      fs: container.fs,
      filePath: container.env.configPath,
      readOnly: options.readOnly
    },
    agentId
  );

  return configuredModel || undefined;
}

export function formatSpawnDryRunMessage(label: string, options: SpawnCommandOptions): string {
  const lines: string[] = [`Dry run: would spawn ${label}.`];
  const details: string[] = [];
  const promptDetail = options.useStdin
    ? `(stdin, ${options.prompt.length} chars)`
    : `${REDACTED_PROMPT_ARG} (${options.prompt.length} chars)`;
  details.push(`${chalk.dim("Prompt:")} ${chalk.cyan(promptDetail)}`);

  if (options.args && options.args.length > 0) {
    const renderedArgs = options.args.map((arg) => formatSpawnArg(arg)).join(" ");
    details.push(`${chalk.dim("Args:")} ${chalk.cyan(renderedArgs)}`);
  }

  if (options.cwd) {
    details.push(`${chalk.dim("Cwd:")} ${chalk.cyan(options.cwd)}`);
  }

  if (details.length > 0) {
    lines.push(...details.map((line) => `  ${line}`));
  }

  return lines.join("\n");
}

function formatSpawnArg(arg: string): string {
  const needsQuotes = arg.includes(" ") || arg.includes("\t");
  if (!needsQuotes) {
    return arg;
  }
  return `"${arg.split('"').join('\\"')}"`;
}
