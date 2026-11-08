import type { Command } from "commander";
import type { CliContainer } from "../../../container.js";
import { registerRuntimeTemplatesClearCommand } from "./clear.js";
import { registerRuntimeTemplatesLsCommand } from "./ls.js";

export function registerRuntimeTemplatesCommand(
  runtime: Command,
  root: Command,
  container: CliContainer
): void {
  const templates = runtime
    .command("templates")
    .description("Inspect and clear locally built runtime templates.");

  registerRuntimeTemplatesLsCommand(templates, root, container);
  registerRuntimeTemplatesClearCommand(templates, root, container);
}
