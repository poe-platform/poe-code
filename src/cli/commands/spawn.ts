import path from "node:path";
import type { Command } from "commander";
import { Option } from "commander";
import type { CliContainer } from "../container.js";
import {
  renderAcpEvent,
  spawnInteractive,
  getSpawnConfig,
  listMcpSupportedAgents,
  supportsMcpAtSpawn,
  type McpSpawnConfig,
  type SpawnMode
} from "@poe-code/agent-spawn";
import { resolveAgentId } from "@poe-code/agent-defs";
import {
  text,
  confirm,
  isCancel,
  resolveOutputFormat,
  renderMarkdown
} from "@poe-code/design-system";
import { loadConfiguredServices } from "../../services/config.js";
import {
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter,
  formatServiceList,
  buildResumeCommand,
  type CommandFlags,
  type ExecutionResources
} from "./shared.js";
import type { SpawnCommandOptions } from "../../providers/spawn-options.js";
import { resolveConfiguredModel, spawnCore } from "../../sdk/spawn-core.js";
import { spawn as spawnSdk } from "../../sdk/spawn.js";
import { spawnAutonomous } from "../../sdk/autonomous.js";
import type { FileSystem } from "../../utils/file-system.js";
import { OperationCancelledError, ValidationError } from "../errors.js";
import { resolveSpawnWorkspace } from "../../workspace/resolve-spawn-workspace.js";
import { addRuntimeOptions, pickRuntimeOptions, type RuntimeCliOptions } from "./runtime-options.js";

export interface CustomSpawnHandlerContext {
  container: CliContainer;
  service: string;
  options: SpawnCommandOptions;
  flags: CommandFlags;
  resources: ExecutionResources;
}

export type CustomSpawnHandler = (context: CustomSpawnHandlerContext) => Promise<void>;

export interface RegisterSpawnCommandOptions {
  handlers?: Record<string, CustomSpawnHandler>;
  extraServices?: string[];
}

export function registerSpawnCommand(
  program: Command,
  container: CliContainer,
  options: RegisterSpawnCommandOptions = {}
): void {
  const spawnServices = container.registry
    .list()
    .filter((service) => typeof service.spawn === "function" || getSpawnConfig(service.name));
  const extraServices = options.extraServices ?? [];
  const serviceList = listSpawnServiceNames(spawnServices, extraServices);
  const serviceDescription = `Agent to spawn${formatServiceList(serviceList)}`;

  const spawnCommand = program
    .command("spawn")
    .alias("s")
    .description("Run a single prompt through a configured agent CLI.")
    .option("--model <model>", "Model identifier override passed to the agent CLI")
    .option("-C, --cwd <path>", "Working directory or workspace locator for the agent CLI")
    .option("--stdin", "Read the prompt from stdin")
    .option("-i, --interactive", "Launch the agent in interactive TUI mode")
    .option("--mode <mode>", "Permission mode: yolo | edit | read (default: yolo)")
    .option(
      "--mcp-servers <json|@file>",
      "MCP server config JSON (or @path/to/file.json): {name: {command, args?, env?}}"
    )
    .addOption(
      new Option("--mcp-config <json|@file>", "[deprecated: use --mcp-servers]").hideHelp()
    )
    .option("--log-dir <path>", "Directory override for ACP JSONL spawn logs")
    .option(
      "--activity-timeout-ms <ms>",
      "Kill the agent after N ms of inactivity",
      (value: string) => parsePositiveInt(value, "--activity-timeout-ms")
    );

  addRuntimeOptions(spawnCommand)
    .argument("<agent>", serviceDescription)
    .argument("[prompt]", "Prompt text to send, '@path/to/file' to load from a file, or '-' / stdin")
    .argument("[agentArgs...]", "Additional arguments forwarded to the agent CLI")
    .action(async function (
      this: Command,
      service: string,
      promptText: string | undefined,
      agentArgs: string[] = []
    ) {
      const flags = resolveCommandFlags(program);
      const commandOptions = this.opts<{
        model?: string;
        cwd?: string;
        stdin?: boolean;
        interactive?: boolean;
        mode?: string;
        mcpServers?: string;
        mcpConfig?: string;
        logDir?: string;
        activityTimeoutMs?: number;
      } & RuntimeCliOptions>();
      const runtimeOptions = pickRuntimeOptions(commandOptions);
      const shouldEmitUiOutput = resolveOutputFormat() !== "json";
      const rawMcpInput = commandOptions.mcpServers ?? commandOptions.mcpConfig;
      const mcpInput = await resolveMcpSpawnInput(rawMcpInput, container.fs, container.env.cwd);
      const mcpServers = parseMcpSpawnConfig(mcpInput);

      const wantsStdinFlag = commandOptions.stdin === true;
      const shouldReadFromStdin =
        wantsStdinFlag || promptText === "-" || (!promptText && !process.stdin.isTTY);

      const forwardedArgs = wantsStdinFlag
        ? [...(promptText ? [promptText] : []), ...agentArgs]
        : agentArgs;

      if (wantsStdinFlag) {
        promptText = undefined;
      }

      if (promptText === "-") {
        promptText = undefined;
      }

      if (promptText !== undefined) {
        promptText = await resolvePromptInput(promptText, container.fs, container.env.cwd);
      }

      if (!promptText && shouldReadFromStdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        promptText = Buffer.concat(chunks).toString("utf8").trim();
      }

      if (!promptText && !commandOptions.interactive) {
        throw new Error("No prompt provided via argument or stdin");
      }
      const prompt = promptText ?? "";

      const workspace = await resolveSpawnWorkspace(commandOptions.cwd, {
        baseDir: container.env.cwd,
        homeDir: container.env.homeDir,
        mode: commandOptions.mode as SpawnMode | undefined,
        resolveRemoteLocators: !flags.dryRun,
        fs: container.fs,
        exec: container.commandRunner
      });
      const cwdOverride = workspace.cwd;

      try {
        if (commandOptions.interactive) {
          const adapter = resolveServiceAdapter(container, service);
          const canonicalService = adapter.name;
          assertInteractiveSupport(adapter.label, canonicalService);
          const proceed = await confirmUnconfiguredService(
            container,
            canonicalService,
            adapter.label,
            flags
          );
          if (!proceed) {
            return;
          }
          const model = await resolveConfiguredModel(
            container,
            canonicalService,
            commandOptions.model
          );
          const result = await spawnInteractive(canonicalService, {
            prompt,
            args: forwardedArgs,
            model,
            mode: commandOptions.mode as SpawnMode | undefined,
            ...runtimeOptions,
            ...(mcpServers ? { mcpServers } : {}),
            cwd: cwdOverride
          });
          process.exitCode = result.exitCode;
          return;
        }

        const directSpawnOptions: SpawnCommandOptions = {
          prompt,
          args: forwardedArgs,
          model: commandOptions.model,
          mode: commandOptions.mode as SpawnMode | undefined,
          mcpServers,
          cwd: cwdOverride,
          logDir: commandOptions.logDir,
          activityTimeoutMs: commandOptions.activityTimeoutMs,
          ...runtimeOptions,
          useStdin: shouldReadFromStdin
        };

        const directHandler = options.handlers?.[service];
        if (directHandler) {
          const resources = createExecutionResources(container, flags, `spawn:${service}`);
          if (shouldEmitUiOutput) {
            resources.logger.intro(`spawn ${service}`);
          }
          await directHandler({
            container,
            service,
            options: directSpawnOptions,
            flags,
            resources
          });
          if (shouldEmitUiOutput) {
            resources.context.finalize();
          }
          return;
        }

        const adapter = resolveServiceAdapter(container, service);
        const canonicalService = adapter.name;
        const model = await resolveConfiguredModel(
          container,
          canonicalService,
          commandOptions.model
        );
        const spawnOptions: SpawnCommandOptions = {
          ...directSpawnOptions,
          model
        };
        const resources = createExecutionResources(container, flags, `spawn:${canonicalService}`);
        if (shouldEmitUiOutput) {
          resources.logger.intro(`spawn ${canonicalService}`);
        }
        const canonicalHandler = options.handlers?.[canonicalService];
        if (canonicalHandler) {
          try {
            await canonicalHandler({
              container,
              service: canonicalService,
              options: spawnOptions,
              flags,
              resources
            });
            return;
          } finally {
            if (shouldEmitUiOutput) {
              resources.context.finalize();
            }
          }
        }

        try {
          assertSpawnSupport(adapter.label, canonicalService, typeof adapter.spawn === "function");

          assertMcpSpawnSupport(
            adapter.label,
            canonicalService,
            adapter.supportsMcpSpawn === true,
            mcpServers
          );

          if (flags.dryRun) {
            await spawnCore(container, canonicalService, spawnOptions, {
              dryRun: true,
              verbose: flags.verbose
            });
            return;
          }

          const proceed = await confirmUnconfiguredService(
            container,
            canonicalService,
            adapter.label,
            flags
          );
          if (!proceed) {
            return;
          }

          const final = await spawnAutonomous(spawnSdk, {
            service: canonicalService,
            prompt: spawnOptions.prompt,
            args: spawnOptions.args,
            model: spawnOptions.model,
            mode: spawnOptions.mode,
            cwd: spawnOptions.cwd,
            ...(spawnOptions.mcpServers ? { mcpServers: spawnOptions.mcpServers } : {}),
            ...(spawnOptions.logDir !== undefined ? { logDir: spawnOptions.logDir } : {}),
            ...(spawnOptions.activityTimeoutMs !== undefined
              ? { activityTimeoutMs: spawnOptions.activityTimeoutMs }
              : {}),
            ...runtimeOptions
          });
          process.exitCode = final.exitCode;

          if (!shouldEmitUiOutput) {
            renderAcpEvent({
              event: "spawn_result",
              exitCode: final.exitCode,
              ...(final.threadId ? { threadId: final.threadId } : {}),
              ...(final.usage ? { usage: final.usage } : {}),
              protocolVersion: 1
            });
          }

          if (final.exitCode !== 0) {
            if (!shouldEmitUiOutput) {
              return;
            }
            const detail = final.stderr.trim() || final.stdout.trim();
            const suffix = detail ? `: ${detail}` : "";
            throw new Error(
              `${adapter.label} spawn failed with exit code ${final.exitCode}${suffix}`
            );
          }

          if (shouldEmitUiOutput) {
            const trimmedStdout = final.stdout.trim();
            if (trimmedStdout) {
              resources.logger.info(renderMarkdown(trimmedStdout).trimEnd());
            } else {
              const trimmedStderr = final.stderr.trim();
              if (trimmedStderr) {
                resources.logger.info(renderMarkdown(trimmedStderr).trimEnd());
              }
            }
          }

          if (shouldEmitUiOutput && final.threadId) {
            const resumeCommand = buildResumeCommand(
              canonicalService,
              final.threadId,
              spawnOptions.cwd ?? process.cwd()
            );
            if (resumeCommand) {
              resources.logger.info(text.muted(`\nResume: ${resumeCommand}`));
            }
          }
        } finally {
          if (shouldEmitUiOutput) {
            resources.context.finalize();
          }
        }
      } finally {
        await workspace.cleanup?.();
      }
    });
}

function listSpawnServiceNames(
  services: Array<{ name: string; aliases?: string[] }>,
  extraServices: string[]
): string[] {
  const names: string[] = [];

  const add = (value: string | undefined): void => {
    const normalized = value?.trim();
    if (!normalized || names.includes(normalized)) {
      return;
    }
    names.push(normalized);
  };

  for (const service of services) {
    add(service.name);
    for (const alias of service.aliases ?? []) {
      add(alias);
    }
  }

  for (const service of extraServices) {
    add(service);
  }

  return names;
}

async function confirmUnconfiguredService(
  container: CliContainer,
  service: string,
  label: string,
  flags: CommandFlags
): Promise<boolean> {
  const configuredServices = await loadConfiguredServices({
    fs: container.fs,
    filePath: container.env.configPath,
    projectFilePath: container.env.projectConfigPath
  });

  if (service in configuredServices) {
    return true;
  }

  if (flags.assumeYes) {
    return true;
  }

  const shouldProceed = await confirm({
    message: `${label} is not configured via poe. Do you want to proceed?`
  });

  if (isCancel(shouldProceed)) {
    throw new OperationCancelledError();
  }

  return shouldProceed === true;
}

async function resolvePromptInput(
  input: string,
  fs: FileSystem,
  baseDir: string
): Promise<string> {
  if (!input.startsWith("@")) {
    return input;
  }

  const rawPath = input.slice(1);
  if (rawPath.length === 0) {
    throw new ValidationError("prompt @<path> requires a file path after '@'");
  }

  const filePath = path.isAbsolute(rawPath) ? rawPath : path.join(baseDir, rawPath);

  try {
    const contents = await fs.readFile(filePath, "utf8");
    return contents.trim();
  } catch (error) {
    throw new ValidationError(
      `prompt could not read file "${filePath}": ${(error as Error).message}`
    );
  }
}

async function resolveMcpSpawnInput(
  input: string | undefined,
  fs: FileSystem,
  baseDir: string
): Promise<string | undefined> {
  if (!input) {
    return undefined;
  }

  if (!input.startsWith("@")) {
    return input;
  }

  const rawPath = input.slice(1);
  if (rawPath.length === 0) {
    throw new ValidationError("--mcp-servers @<path> requires a file path after '@'");
  }

  const filePath = path.isAbsolute(rawPath) ? rawPath : path.join(baseDir, rawPath);

  try {
    return await fs.readFile(filePath, "utf8");
  } catch (error) {
    throw new ValidationError(
      `--mcp-servers could not read file "${filePath}": ${(error as Error).message}`
    );
  }
}

function parseMcpSpawnConfig(input?: string): McpSpawnConfig | undefined {
  if (!input) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new ValidationError(
      "--mcp-servers must be valid JSON in this shape: {name: {command, args?, env?}}"
    );
  }

  if (!isObjectRecord(parsed)) {
    throw new ValidationError(
      "--mcp-servers must be an object in this shape: {name: {command, args?, env?}}"
    );
  }

  const source =
    "mcpServers" in parsed && isObjectRecord(parsed.mcpServers) ? parsed.mcpServers : parsed;

  const servers: McpSpawnConfig = {};
  for (const [name, value] of Object.entries(source)) {
    if (!isObjectRecord(value)) {
      throw new ValidationError(
        `--mcp-servers entry "${name}" must be an object: {command, args?, env?}`
      );
    }

    const command = value.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      throw new ValidationError(
        `--mcp-servers entry "${name}" must include a non-empty string "command"`
      );
    }

    let args: string[] | undefined;
    if ("args" in value && value.args !== undefined) {
      if (!Array.isArray(value.args)) {
        throw new ValidationError(`--mcp-servers entry "${name}".args must be an array of strings`);
      }

      args = [];
      for (const arg of value.args) {
        if (typeof arg !== "string") {
          throw new ValidationError(
            `--mcp-servers entry "${name}".args must be an array of strings`
          );
        }
        args.push(arg);
      }
    }

    let env: Record<string, string> | undefined;
    if ("env" in value && value.env !== undefined) {
      if (!isObjectRecord(value.env)) {
        throw new ValidationError(
          `--mcp-servers entry "${name}".env must be an object of string values`
        );
      }
      env = {};
      for (const [envKey, envValue] of Object.entries(value.env)) {
        if (typeof envValue !== "string") {
          throw new ValidationError(
            `--mcp-servers entry "${name}".env must be an object of string values`
          );
        }
        env[envKey] = envValue;
      }
    }

    let timeout: number | undefined;
    if ("timeout" in value && value.timeout !== undefined) {
      if (typeof value.timeout !== "number" || value.timeout <= 0) {
        throw new ValidationError(
          `--mcp-servers entry "${name}".timeout must be a positive number (seconds)`
        );
      }
      timeout = value.timeout;
    }

    servers[name] = {
      command,
      ...(args ? { args } : {}),
      ...(env ? { env } : {}),
      ...(timeout !== undefined ? { timeout } : {})
    };
  }

  return Object.keys(servers).length > 0 ? servers : undefined;
}

function assertMcpSpawnSupport(
  label: string,
  service: string,
  providerSupportsMcpSpawn: boolean,
  servers?: McpSpawnConfig
): void {
  if (!servers || Object.keys(servers).length === 0) {
    return;
  }
  if (supportsMcpAtSpawn(service) || providerSupportsMcpSpawn) {
    return;
  }

  const supported = listMcpSupportedAgents();
  throw new ValidationError(
    `${label} does not support MCP servers at spawn time.\n` +
      `Agents with spawn-time MCP support: ${supported.join(", ")}`
  );
}

function parsePositiveInt(value: string, fieldName: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) {
    throw new ValidationError(`Invalid ${fieldName} "${value}". Expected a positive integer.`);
  }
  return parsed;
}

function assertSpawnSupport(label: string, service: string, providerSupportsSpawn: boolean): void {
  if (providerSupportsSpawn) {
    return;
  }
  if (getSpawnConfig(service)) {
    return;
  }
  throw new ValidationError(`${label} does not support spawn.`);
}

function assertInteractiveSupport(label: string, service: string): void {
  const spawnConfig = getSpawnConfig(service);
  if (spawnConfig?.kind === "cli" && spawnConfig.interactive) {
    return;
  }
  if (resolveAgentId(service)) {
    return;
  }
  throw new ValidationError(`${label} does not support interactive mode.`);
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
