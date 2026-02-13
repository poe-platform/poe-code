import path from "node:path";
import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { renderAcpStream, spawnInteractive, getSpawnConfig, type SpawnMode } from "@poe-code/agent-spawn";
import { allAgents, resolveAgentId } from "@poe-code/agent-defs";
import { text, confirm, isCancel } from "@poe-code/design-system";
import { loadConfiguredServices } from "../../services/credentials.js";
import {
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter,
  formatServiceList,
  type CommandFlags,
  type ExecutionResources
} from "./shared.js";
import type { SpawnCommandOptions } from "../../providers/spawn-options.js";
import { spawnCore } from "../../sdk/spawn-core.js";
import { spawn as spawnSdk } from "../../sdk/spawn.js";

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
      const commandOptions = this.opts<{ model?: string; cwd?: string; stdin?: boolean; interactive?: boolean; mode?: string }>();
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
          cwd: spawnOptions.cwd
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
          const spawnConfig = getSpawnConfig(canonicalService);
          if (spawnConfig?.kind === "cli" && spawnConfig.resumeCommand) {
            const resolvedId = resolveAgentId(canonicalService) ?? canonicalService;
            const agentDefinition = allAgents.find((agent) => agent.id === resolvedId);
            const binaryName = agentDefinition?.binaryName;
            if (binaryName) {
              const resumeCwd = path.resolve(spawnOptions.cwd ?? process.cwd());
              const args = spawnConfig.resumeCommand(final.threadId, resumeCwd);
              const agentCommand = [binaryName, ...args.map(shlexQuote)].join(" ");
              const needsCdPrefix = !args.includes(resumeCwd);
              const resumeCommand = needsCdPrefix
                ? `cd ${shlexQuote(resumeCwd)} && ${agentCommand}`
                : agentCommand;
              resources.logger.info(text.muted(`\nResume: ${resumeCommand}`));
            }
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
    filePath: container.env.credentialsPath
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

  return !isCancel(shouldProceed) && shouldProceed === true;
}

function shlexQuote(value: string): string {
  if (value.length === 0) {
    return "''";
  }

  let isSafe = true;
  for (let index = 0; index < value.length; index += 1) {
    if (!isSafeShellChar(value.charCodeAt(index))) {
      isSafe = false;
      break;
    }
  }

  if (isSafe) {
    return value;
  }

  let output = "'";
  for (let index = 0; index < value.length; index += 1) {
    const char = value[index];
    if (char === "'") {
      output += `'"'"'`;
      continue;
    }
    output += char;
  }
  output += "'";
  return output;
}

function isSafeShellChar(code: number): boolean {
  if (code >= 48 && code <= 57) {
    return true;
  }
  if (code >= 65 && code <= 90) {
    return true;
  }
  if (code >= 97 && code <= 122) {
    return true;
  }

  switch (code) {
    case 95: // _
    case 64: // @
    case 37: // %
    case 43: // +
    case 61: // =
    case 58: // :
    case 44: // ,
    case 46: // .
    case 47: // /
    case 45: // -
      return true;
    default:
      return false;
  }
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
