import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { registerConfigCommand } from "./config.js";

export function registerUtilsCommand(program: Command, container: CliContainer): void {
  const utils = program
    .command("utils")
    .description("Utility commands for inspecting and managing poe-code.")
    .addHelpCommand(false);

  registerConfigCommand(utils, container);
}
