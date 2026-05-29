import type { Command } from "commander";
import { selectExecutionEnvFactory, type ExecutionEnvType } from "@poe-code/agent-harness-tools";
import type { CliContainer } from "../../../container.js";
import { createExecutionResources, resolveCommandFlags } from "../../shared.js";

export function registerRuntimeJobsSandboxCommand(
  jobs: Command,
  root: Command,
  container: CliContainer
): void {
  jobs
    .command("sandbox")
    .description("Open a shell in a runtime sandbox.")
    .argument("<envId>", "Runtime sandbox id")
    .option("--runtime <runtime>", "Runtime backend for the sandbox", "docker")
    .action(async (envId: string, options: { runtime: string }) => {
      const flags = resolveCommandFlags(root);
      const resources = createExecutionResources(container, flags, "runtime:jobs:sandbox");
      if (flags.dryRun) {
        resources.logger.dryRun(
          `Dry run: would open a shell in ${options.runtime} runtime sandbox ${envId}.`
        );
        return;
      }
      const factory = selectExecutionEnvFactory(options.runtime as ExecutionEnvType);
      const env = await factory.attach(envId);
      const handle = env.shell();
      process.exitCode = (await handle.result).exitCode;
    });
}
