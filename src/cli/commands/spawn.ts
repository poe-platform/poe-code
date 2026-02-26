import path from "node:path";
import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  renderAcpStream,
  spawnInteractive,
  getSpawnConfig,
  listMcpSupportedAgents,
  supportsMcpAtSpawn,
  type McpSpawnConfig,
  type SpawnMode
} from "@poe-code/agent-spawn";
import { text, confirm, isCancel } from "@poe-code/design-system";
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
import { spawnCore } from "../../sdk/spawn-core.js";
import { spawn as spawnSdk } from "../../sdk/spawn.js";
import { OperationCancelledError, ValidationError } from "../errors.js";

export interface CustomSpawnHandlerContext {
  container: CliContainer;
  service: string;
  options: SpawnCommandOptions;
  flags: CommandFlags;
  resources: ExecutionResources;
}

export type CustomSpawnHandler = (
  context: CustomSpawnHandlerContext
) => Promise<void>;

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
    .filter((service) => typeof service.spawn === "function" || getSpawnConfig(service.name))
    .map((service) => service.name);
  const extraServices = options.extraServices ?? [];
  const serviceList = [...spawnServices, ...extraServices];
  const serviceDescription =
    `Agent to spawn${formatServiceList(serviceList)}`;

  program
    .command("spawn")
    .description("Run a single prompt through a configured agent CLI.")
    .option("--model <model>", "Model identifier override passed to the agent CLI")
    .option("-C, --cwd <path>", "Working directory for the agent CLI")
    .option("--stdin", "Read the prompt from stdin")
    .option("-i, --interactive", "Launch the agent in interactive TUI mode")
    .option("--mode <mode>", "Permission mode: yolo | edit | read (default: yolo)")
    .option(
      "--mcp-config <json>",
      "MCP server config JSON: {name: {command, args?, env?}}"
    )
    .argument(
      "<agent>",
      serviceDescription
    )
    .argument("[prompt]", "Prompt text to send (or '-' / stdin)")
    .argument(
      "[agentArgs...]",
      "Additional arguments forwarded to the agent CLI"
    )
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
        mcpConfig?: string;
      }>();
      const mcpServers = parseMcpSpawnConfig(commandOptions.mcpConfig);
      const cwdOverride = resolveSpawnWorkingDirectory(
        container.env.cwd,
        commandOptions.cwd
      );

      const wantsStdinFlag = commandOptions.stdin === true;
      const shouldReadFromStdin =
        wantsStdinFlag ||
        promptText === "-" ||
        (!promptText && !process.stdin.isTTY);

      const forwardedArgs = wantsStdinFlag
        ? [...(promptText ? [promptText] : []), ...agentArgs]
        : agentArgs;

      if (wantsStdinFlag) {
        promptText = undefined;
      }

      if (promptText === "-") {
        promptText = undefined;
      }

      if (commandOptions.interactive) {
        const adapter = resolveServiceAdapter(container, service);
        const proceed = await confirmUnconfiguredService(
          container,
          adapter.name,
          adapter.label,
          flags
        );
        if (!proceed) {
          return;
        }
        const result = await spawnInteractive(adapter.name, {
          prompt: promptText ?? "",
          args: forwardedArgs,
          model: commandOptions.model,
          mode: commandOptions.mode as SpawnMode | undefined,
          ...(mcpServers ? { mcpServers } : {}),
          cwd: cwdOverride
        });
        process.exitCode = result.exitCode;
        return;
      }

      if (!promptText && shouldReadFromStdin) {
        const chunks: Buffer[] = [];
        for await (const chunk of process.stdin) {
          chunks.push(chunk);
        }
        promptText = Buffer.concat(chunks).toString("utf8").trim();
      }

      if (!promptText) {
        throw new Error("No prompt provided via argument or stdin");
      }

      const spawnOptions: SpawnCommandOptions = {
        prompt: promptText,
        args: forwardedArgs,
        model: commandOptions.model,
        mode: commandOptions.mode as SpawnMode | undefined,
        mcpServers,
        cwd: cwdOverride,
        useStdin: shouldReadFromStdin
      };

      // Check for custom handlers first
      const directHandler = options.handlers?.[service];
      if (directHandler) {
        const resources = createExecutionResources(
          container,
          flags,
          `spawn:${service}`
        );
        resources.logger.intro(`spawn ${service}`);
        await directHandler({
          container,
          service,
          options: spawnOptions,
          flags,
          resources
        });
        resources.context.finalize();
        return;
      }

      const adapter = resolveServiceAdapter(container, service);
      const canonicalService = adapter.name;
      const resources = createExecutionResources(
        container,
        flags,
        `spawn:${canonicalService}`
      );
      resources.logger.intro(`spawn ${canonicalService}`);
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
          resources.context.finalize();
        }
      }

      try {
        assertMcpSpawnSupport(
          adapter.label,
          canonicalService,
          adapter.supportsMcpSpawn === true,
          mcpServers,
        );

        if (flags.dryRun) {
          // spawnCore already logs the dry run details.
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

        const { events, result } = spawnSdk(canonicalService, {
          prompt: spawnOptions.prompt,
          args: spawnOptions.args,
          model: spawnOptions.model,
          mode: spawnOptions.mode,
          cwd: spawnOptions.cwd,
          ...(spawnOptions.mcpServers
            ? { mcpServers: spawnOptions.mcpServers }
            : {})
        });

        await renderAcpStream(events);

        const final = await result;

        if (final.exitCode !== 0) {
          const detail = final.stderr.trim() || final.stdout.trim();
          const suffix = detail ? `: ${detail}` : "";
          throw new Error(
            `${adapter.label} spawn failed with exit code ${final.exitCode}${suffix}`
          );
        }

        const trimmedStdout = final.stdout.trim();
        if (trimmedStdout) {
          resources.logger.info(trimmedStdout);
        } else {
          const trimmedStderr = final.stderr.trim();
          if (trimmedStderr) {
            resources.logger.info(trimmedStderr);
          } else {
            resources.logger.info(`${adapter.label} spawn completed.`);
          }
        }

        if (final.threadId) {
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
        resources.context.finalize();
      }
    });
}

async function confirmUnconfiguredService(
  container: CliContainer,
  service: string,
  label: string,
  flags: CommandFlags
): Promise<boolean> {
  const configuredServices = await loadConfiguredServices({
    fs: container.fs,
    filePath: container.env.configPath
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

function parseMcpSpawnConfig(input?: string): McpSpawnConfig | undefined {
  if (!input) {
    return undefined;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    throw new ValidationError(
      "--mcp-config must be valid JSON in this shape: {name: {command, args?, env?}}"
    );
  }

  if (!isObjectRecord(parsed)) {
    throw new ValidationError(
      "--mcp-config must be an object in this shape: {name: {command, args?, env?}}"
    );
  }

  const servers: McpSpawnConfig = {};
  for (const [name, value] of Object.entries(parsed)) {
    if (!isObjectRecord(value)) {
      throw new ValidationError(
        `--mcp-config entry "${name}" must be an object: {command, args?, env?}`
      );
    }

    const command = value.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      throw new ValidationError(
        `--mcp-config entry "${name}" must include a non-empty string "command"`
      );
    }

    let args: string[] | undefined;
    if ("args" in value && value.args !== undefined) {
      if (!Array.isArray(value.args)) {
        throw new ValidationError(
          `--mcp-config entry "${name}".args must be an array of strings`
        );
      }

      args = [];
      for (const arg of value.args) {
        if (typeof arg !== "string") {
          throw new ValidationError(
            `--mcp-config entry "${name}".args must be an array of strings`
          );
        }
        args.push(arg);
      }
    }

    let env: Record<string, string> | undefined;
    if ("env" in value && value.env !== undefined) {
      if (!isObjectRecord(value.env)) {
        throw new ValidationError(
          `--mcp-config entry "${name}".env must be an object of string values`
        );
      }
      env = {};
      for (const [envKey, envValue] of Object.entries(value.env)) {
        if (typeof envValue !== "string") {
          throw new ValidationError(
            `--mcp-config entry "${name}".env must be an object of string values`
          );
        }
        env[envKey] = envValue;
      }
    }

    servers[name] = {
      command,
      ...(args ? { args } : {}),
      ...(env ? { env } : {})
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

function isObjectRecord(
  value: unknown
): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
