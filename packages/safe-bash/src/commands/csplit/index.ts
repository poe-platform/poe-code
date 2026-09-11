import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createBoundedRegexProvider } from "../regex-execution/bounded-provider.js";
import { RegexExecutor } from "../regex-execution/portable.js";
import { createCsplitCommandWithExecutor } from "./command.js";
import type { CsplitCommandsOptions } from "./internal.js";

export type { CsplitCommandsOptions, CsplitLimits } from "./internal.js";

export function createCsplitCommand(options: CsplitCommandsOptions = {}): CommandDefinition {
  const provider = options.regexExecutor === undefined ? createBoundedRegexProvider() : options.regexExecutor;
  return createCsplitCommandWithExecutor(new RegexExecutor(provider, options.regex), options);
}

export function createCsplitCommands(options: CsplitCommandsOptions = {}): readonly CommandDefinition[] {
  return [createCsplitCommand(options)];
}

export function csplitCommands(options: CsplitCommandsOptions = {}): VirtualShellPlugin {
  const provider = options.regexExecutor === undefined ? createBoundedRegexProvider() : options.regexExecutor;
  const executor = new RegexExecutor(provider, options.regex);
  const command = createCsplitCommandWithExecutor(executor, options);
  return { name: "csplit-commands", setup(host) {
    if (!options.replace && host.commands.has("csplit")) throw new Error("Command already registered: csplit");
    host.commands.register(command, { replace: options.replace ?? false });
  }, async dispose() { await executor.dispose(); } };
}
