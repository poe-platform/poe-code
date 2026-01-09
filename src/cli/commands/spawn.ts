import path from "node:path";
import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import {
  buildProviderContext,
  createExecutionResources,
  resolveCommandFlags,
  resolveServiceAdapter,
  type CommandFlags,
  type ExecutionResources
,
} from "./shared.js";
import type { CommandRunnerResult } from "../../utils/command-checks.js";
import type { SpawnCommandOptions } from "../../providers/spawn-options.js";

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

      if (typeof adapter.spawn !== "function") {
        throw new Error(`${adapter.label} does not support spawn.`);
      }
      if (spawnOptions.useStdin && !adapter.supportsStdinPrompt) {
        throw new Error(
          `${adapter.label} does not support stdin prompts. Use a different service (e.g. "codex") or pass the prompt as an argument.`
        );
      }

      const providerContext = buildProviderContext(
        container,
        adapter,
        resources
      );

      if (flags.dryRun) {
        const extra =
          spawnOptions.args && spawnOptions.args.length > 0
            ? ` with args ${JSON.stringify(spawnOptions.args)}`
            : "";
        const cwdSuffix = spawnOptions.cwd ? ` from ${spawnOptions.cwd}` : "";
        const promptDetail = spawnOptions.useStdin
          ? `(stdin, ${spawnOptions.prompt.length} chars)`
          : `"${spawnOptions.prompt}"`;
        resources.logger.dryRun(
          `Dry run: would spawn ${adapter.label} with prompt ${promptDetail}${extra}${cwdSuffix}.`
        );
        return;
      }

      const result = (await container.registry.invoke(
        canonicalService,
        "spawn",
        async (entry) => {
          if (!entry.spawn) {
            throw new Error(`${adapter.label} does not support spawn.`);
          }
          const output = await entry.spawn(providerContext, spawnOptions);
          return output as CommandRunnerResult | void;
        }
      )) as CommandRunnerResult | void;

      if (!result) {
        resources.logger.info(`${adapter.label} spawn completed.`);
        return;
      }

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
