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
    .configureHelp({
      formatHelp: () => [
        "Poe - utils symlink",
        "",
        "Usage: poe-code utils symlink [options] [command]",
        "",
        "Keep agent tool files interchangeable via symlinks.",
        "",
        "Commands:",
        "  agents   Symlink CLAUDE.md <- AGENTS.md (AGENTS.md is canonical).",
        "  skills   Move .claude/skills into .agents/skills and symlink it back.",
        ""
      ].join("\n")
    })
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
}
