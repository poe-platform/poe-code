import type { Command } from "commander";
import { selectExecutionEnvFactory, type ExecutionEnvType } from "@poe-code/agent-harness-tools";
import type { CliContainer } from "../../../container.js";

export function registerRuntimeJobsSandboxCommand(
  jobs: Command,
  _root: Command,
  _container: CliContainer
): void {
  jobs
    .command("sandbox")
    .description("Open a shell in a runtime sandbox.")
    .argument("<envId>", "Runtime sandbox id")
    .option("--runtime <runtime>", "Runtime backend for the sandbox", "docker")
    .action(async (envId: string, options: { runtime: string }) => {
      const factory = selectExecutionEnvFactory(options.runtime as ExecutionEnvType);
      const env = await factory.attach(envId);
      const handle = env.shell();
      process.exitCode = (await handle.result).exitCode;
    });
}
