import { registerDefaultExecutors } from "../internal.js";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createGrepCommands } from "safe-bash-command-grep";
import { createGrepAliases } from "safe-bash-command-grep/aliases";
import type { GrepAliasOptions } from "safe-bash-command-grep/alias-options";
export type { GrepAliasOptions } from "safe-bash-command-grep/alias-options";
export { createEgrepCommand as egrepCommand } from "../egrep/index.js";
export { createFgrepCommand as fgrepCommand } from "../fgrep/index.js";
export { createRgrepCommand as rgrepCommand } from "../rgrep/index.js";
export function createGrepAliasCommands(options: GrepAliasOptions = {}): readonly CommandDefinition[] {
  const grep = createGrepCommands({ ...options.regex, ...(options.regexExecutor === undefined ? {} : { regexExecutor: options.regexExecutor }) })[0]!;
  return createGrepAliases(grep);
}
export function grepAliasCommands(options: GrepAliasOptions = {}): VirtualShellPlugin { const commands = createGrepAliasCommands(options); return {name: "grep-alias-commands", setup(host) { if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`); for(const command of commands) host.commands.register(command,{replace:options.replace??false}); } }; }
