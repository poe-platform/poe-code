import { Option, type Command } from "commander";
import type { CliContainer } from "../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../shared.js";
import {
  resolveRuntimeType,
  updateRuntimeScope,
  writeDefaultDockerfileIfNeeded
} from "./shared.js";

export interface RuntimeInitOptions {
  type?: string;
  dockerfile?: boolean;
}

export function registerRuntimeInitCommand(
  runtime: Command,
  root: Command,
  container: CliContainer
): void {
  runtime
    .command("init")
    .description("Initialize project runtime configuration.")
    .addOption(new Option("--type <type>", "Runtime backend").choices(["host", "docker"]))
    .option("--no-dockerfile", "Do not create .poe-code/Dockerfile.")
    .action(async (options: RuntimeInitOptions) => {
      await executeRuntimeInit(root, container, options);
    });
}

async function executeRuntimeInit(
  program: Command,
  container: CliContainer,
  options: RuntimeInitOptions
): Promise<void> {
  const flags = resolveCommandFlags(program);
  const resources = createExecutionResources(container, flags, "runtime:init");
  const type = await resolveRuntimeType({
    value: options.type,
    assumeYes: flags.assumeYes
  });

  resources.logger.intro("runtime init");

  if (flags.dryRun) {
    resources.logger.dryRun(`Dry run: would set runtime.type to "${type}".`);
    if (options.dockerfile !== false) {
      resources.logger.dryRun("Dry run: would create .poe-code/Dockerfile if missing.");
    }
    return;
  }

  await updateRuntimeScope({ container, type });
  const wroteDockerfile = await writeDefaultDockerfileIfNeeded({
    container,
    enabled: options.dockerfile !== false
  });

  resources.logger.success(`Updated ${container.env.projectConfigPath}: runtime.type = "${type}"`);
  if (wroteDockerfile) {
    resources.logger.success("Created .poe-code/Dockerfile");
  }
}
