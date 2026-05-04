import type { Command } from "commander";
import type { CliContainer } from "../../container.js";
import { registerRuntimeBuildCommand } from "./build.js";
import { registerRuntimeInitCommand } from "./init.js";
import { registerRuntimeTemplatesCommand } from "./templates/index.js";

export function registerRuntimeCommand(program: Command, container: CliContainer): void {
  const runtime = program
    .command("runtime")
    .description("Manage project runtime templates and cache.");

  registerRuntimeInitCommand(runtime, program, container);
  registerRuntimeBuildCommand(runtime, program, container);
  registerRuntimeTemplatesCommand(runtime, program, container);
}
