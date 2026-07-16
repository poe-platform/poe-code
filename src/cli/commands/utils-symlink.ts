import type { Command } from "commander";
import type { CliContainer } from "../container.js";
import { throwCommandNotFound } from "../command-not-found.js";
import { registerUtilsSymlinkAgentsCommand } from "./utils-symlink-agents.js";
import { registerUtilsSymlinkSkillsCommand } from "./utils-symlink-skills.js";

export function registerUtilsSymlinkCommand(
  parent: Command,
  container: CliContainer
): void {
  const symlink = parent
    .command("symlink")
    .description("Keep agent tool files interchangeable via symlinks.")
    .usage("[options] [command]")
    .addHelpCommand(false)
    .allowExcessArguments()
    .action(function (this: Command) {
      if (this.args.length > 0) {
        throwCommandNotFound({
          container,
          scope: "cli",
          unknownCommand: this.args.at(0) ?? "",
          helpArgs: ["utils", "symlink", "--help"],
          moduleUrl: import.meta.url
        });
      }

      this.help();
    });

  registerUtilsSymlinkAgentsCommand(symlink, container);
  registerUtilsSymlinkSkillsCommand(symlink, container);

  // `utils symlink-skills` is the common guess for the nested command, so register the
  // same command on the parent under that name instead of failing as unknown.
  registerUtilsSymlinkSkillsCommand(parent, container);
  parent.commands.find((command) => command.name() === "skills")?.name("symlink-skills");
}
