import path from "node:path";
import chalk from "chalk";
import type { CliContainer } from "../cli/container.js";
import type { SpawnResult } from "./types.js";
import {
  buildProviderContext,
  createExecutionResources
} from "../cli/commands/shared.js";
import type { SpawnCommandOptions } from "../providers/spawn-options.js";
import type { CommandRunnerResult } from "../utils/command-checks.js";

export interface SpawnCoreOptions {
  /** The prompt to send to the provider */
  prompt: string;
  /** Working directory for the service CLI */
  cwd?: string;
  /** Model identifier override */
  model?: string;
  /** Additional arguments forwarded to the CLI */
  args?: string[];
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
  // Resolve working directory
  const cwdOverride = resolveSpawnWorkingDirectory(
    container.env.cwd,
    options.cwd
  );

  // Build spawn command options (internal format)
  const spawnOptions: SpawnCommandOptions = {
    prompt: options.prompt,
    args: options.args,
    model: options.model,
    cwd: cwdOverride,
    useStdin: options.useStdin ?? false
  };

  // Resolve service adapter
  const adapter = container.registry.get(service);
  if (!adapter) {
    throw new Error(`Unknown service "${service}".`);
  }

  if (typeof adapter.spawn !== "function") {
    throw new Error(`${adapter.label} does not support spawn.`);
  }

  if (spawnOptions.useStdin && !adapter.supportsStdinPrompt) {
    throw new Error(
      `${adapter.label} does not support stdin prompts. Use a different service (e.g. "codex") or pass the prompt as an argument.`
    );
  }

  // Create execution resources (logger, context)
  const commandFlags = { dryRun: flags.dryRun, assumeYes: true, verbose: flags.verbose };
  const resources = createExecutionResources(
    container,
    commandFlags,
    `spawn:${service}`
  );

  // Build provider context
  const providerContext = buildProviderContext(container, adapter, resources);

  // Handle dry run
  if (flags.dryRun) {
    const summary = formatSpawnDryRunMessage(adapter.label, spawnOptions);
    resources.logger.dryRun(summary);
    return {
      stdout: "",
      stderr: "",
      exitCode: 0
    };
  }

  // Invoke spawn through registry
  const result = (await container.registry.invoke(
    adapter.name,
    "spawn",
    async (entry) => {
      if (!entry.spawn) {
        throw new Error(`${adapter.label} does not support spawn.`);
      }
      const output = await entry.spawn(providerContext, spawnOptions);
      return output as CommandRunnerResult | void;
    }
  )) as CommandRunnerResult | void;

  // Return normalized result
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
}

function formatSpawnDryRunMessage(
  label: string,
  options: SpawnCommandOptions
): string {
  const lines: string[] = [`Dry run: would spawn ${label}.`];
  const details: string[] = [];
  const promptDetail = options.useStdin
    ? `(stdin, ${options.prompt.length} chars)`
    : formatQuoted(options.prompt);
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
  return `"${arg.split("\"").join("\\\"")}"`;
}

function formatQuoted(value: string): string {
  return JSON.stringify(value);
}

function resolveSpawnWorkingDirectory(
  baseDir: string,
  candidate?: string
): string | undefined {
  if (!candidate || candidate.trim().length === 0) {
    return undefined;
  }
  if (path.isAbsolute(candidate)) {
    return candidate;
  }
  return path.resolve(baseDir, candidate);
}
