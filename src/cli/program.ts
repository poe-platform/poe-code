import { Command } from "commander";
import {
  createCliContainer,
  type CliContainer,
  type CliDependencies
} from "./container.js";
import {
  registerConfigureCommand,
  resolveServiceArgument,
  executeConfigure
} from "./commands/configure.js";
import { registerSpawnCommand } from "./commands/spawn.js";
import { registerWrapCommand } from "./commands/wrap.js";
import { registerLoginCommand } from "./commands/login.js";
import { registerInstallCommand } from "./commands/install.js";
import { registerRemoveCommand } from "./commands/remove.js";
import { registerTestCommand } from "./commands/test.js";
import { registerQueryCommand } from "./commands/query.js";
import { registerVersionOption } from "./commands/version.js";
import packageJson from "../../package.json" with { type: "json" };

export function createProgram(dependencies: CliDependencies): Command {
  const container = createCliContainer(dependencies);
  const program = bootstrapProgram(container);

  if (dependencies.exitOverride ?? true) {
    applyExitOverride(program);
  }

  if (dependencies.suppressCommanderOutput) {
    suppressCommanderOutput(program);
  }

  return program;
}

function bootstrapProgram(container: CliContainer): Command {
  const program = new Command();
  program
    .name("poe-code")
    .description("Configure Poe API integrations for local developer tooling.")
    .option("-y, --yes", "Accept defaults without prompting.")
    .option("--dry-run", "Simulate commands without writing changes.")
    .option("--verbose", "Show verbose logs.");

  registerVersionOption(program, container, packageJson.version);
  registerInstallCommand(program, container);
  registerConfigureCommand(program, container);
  registerSpawnCommand(program, container);
  registerWrapCommand(program, container);
  registerQueryCommand(program, container);
  registerTestCommand(program, container);
  registerRemoveCommand(program, container);
  registerLoginCommand(program, container);

  program.action(async () => {
    const service = await resolveServiceArgument(program, container);
    await executeConfigure(program, container, service, {});
  });

  return program;
}

export type { CliDependencies };

function applyExitOverride(command: Command): void {
  command.exitOverride();
  for (const child of command.commands) {
    applyExitOverride(child);
  }
}

function suppressCommanderOutput(command: Command): void {
  command.configureOutput({
    writeOut: () => {},
    writeErr: () => {}
  });
  for (const child of command.commands) {
    suppressCommanderOutput(child);
  }
}
