import path from "node:path";
import type { Command } from "commander";
import type { CliContainer } from "../container.js";
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
    .filter((service) => typeof service.spawn === "function")
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
      const commandOptions = this.opts<{ model?: string; cwd?: string; stdin?: boolean }>();
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
        await canonicalHandler({
          container,
          service: canonicalService,
          options: spawnOptions,
          flags,
          resources
        });
        resources.context.finalize();
        return;
      }

      // Use SDK core spawn implementation
      const result = await spawnCore(container, canonicalService, spawnOptions, {
        dryRun: flags.dryRun,
        verbose: flags.verbose
      });

      // Handle dry run - spawnCore already logged the message
      if (flags.dryRun) {
        resources.context.finalize();
        return;
      }

      // Handle result output
      if (result.exitCode !== 0) {
        const detail = result.stderr.trim() || result.stdout.trim();
        const suffix = detail ? `: ${detail}` : "";
        throw new Error(
          `${adapter.label} spawn failed with exit code ${result.exitCode}${suffix}`
        );
      }

      const trimmedStdout = result.stdout.trim();
      if (trimmedStdout) {
        resources.logger.info(trimmedStdout);
        resources.context.finalize();
        return;
      }

      const trimmedStderr = result.stderr.trim();
      if (trimmedStderr) {
        resources.logger.info(trimmedStderr);
        resources.context.finalize();
        return;
      }

      resources.logger.info(`${adapter.label} spawn completed.`);
      resources.context.finalize();
    });
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
