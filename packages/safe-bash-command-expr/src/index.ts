import { registerDefaultExecutor } from "safe-bash-io-engine/internal";
import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { RegexExecutor } from "safe-bash-regex-engine/execution/portable";
import { createBoundedRegexProvider } from "safe-bash-regex-engine/execution/bounded-provider";
import { createExprCommandWithExecutor } from "./command.js";
import type { ExprCommandsOptions } from "./internal.js";

export type { ExprCommandsOptions, ExprLimits } from "./internal.js";

export function createExprCommand(options: ExprCommandsOptions = {}): CommandDefinition {
  const provider = options.regexExecutor === undefined ? createBoundedRegexProvider() : options.regexExecutor;
  return createExprCommandWithExecutor(new RegexExecutor(provider, options.regex), options);
}

export function createExprCommands(options: ExprCommandsOptions = {}): readonly CommandDefinition[] {
  return [registerDefaultExecutor(createExprCommand(options), options)];
}

export function exprCommands(options: ExprCommandsOptions = {}): VirtualShellPlugin {
  const commands = createExprCommands(options);
  return { name: "expr-commands", setup(host) {
    if (!options.replace && host.commands.has("expr")) throw new Error("Command already registered: expr");
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
