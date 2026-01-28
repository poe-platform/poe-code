import path from "node:path";
import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter,
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
  const defaultServices = ["claude-code", "codex", "opencode"];
  const serviceList =
    options.extraServices && options.extraServices.length > 0
      ? [...defaultServices, ...options.extraServices]
      : defaultServices;
  const serviceDescription = `Service to spawn (${serviceList.join(" | ")})`;

  program
    .command("spawn")
    .description("Run a single prompt through a configured service CLI.")
    .option("--model <model>", "Model identifier override passed to the service CLI")
    .option("-C, --cwd <path>", "Working directory for the service CLI")
    .option("--stdin", "Read the prompt from stdin")
    .argument(
      "<service>",
      serviceDescription
    )
    .argument("[prompt]", "Prompt text to send (or '-' / stdin)")
    .argument(
      "[agentArgs...]",
      "Additional arguments forwarded to the service CLI"
    )
    .action(async function (
      this: Command,
      service: string,
      promptText: string | undefined,
      agentArgs: string[] = []
    ) {
      const flags = resolveCommandFlags(program);
      const resources = createExecutionResources(
        container,
        flags,
        `spawn:${service}`
      );
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
        await directHandler({
          container,
          service,
          options: spawnOptions,
          flags,
          resources
        });
        return;
      }

      const adapter = resolveServiceAdapter(container, service);
      const canonicalService = adapter.name;
      const canonicalHandler = options.handlers?.[canonicalService];
      if (canonicalHandler) {
        await canonicalHandler({
          container,
          service: canonicalService,
          options: spawnOptions,
          flags,
          resources
        });
        return;
      }

      // Use SDK core spawn implementation
      const result = await spawnCore(container, service, spawnOptions, {
        dryRun: flags.dryRun,
        verbose: flags.verbose
      });

      // Handle dry run - spawnCore already logged the message
      if (flags.dryRun) {
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
        return;
      }

      const trimmedStderr = result.stderr.trim();
      if (trimmedStderr) {
        resources.logger.info(trimmedStderr);
        return;
      }

      resources.logger.info(`${adapter.label} spawn completed.`);
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
