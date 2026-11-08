import type { CommandDefinition, VirtualShellPlugin } from "safe-bash-contracts";
import { createJqCommand } from "./jq.js";
import type { StructuredCommandsOptions } from "safe-bash-query-engine/limits";
export { createJqCommand } from "./jq.js";
export type { StructuredCommandsOptions as JqCommandsOptions, JqLimits } from "safe-bash-query-engine/limits";
export function createJqCommands(options: StructuredCommandsOptions = {}): readonly CommandDefinition[] { return [createJqCommand(options)]; }
export function jqCommands(options: StructuredCommandsOptions = {}): VirtualShellPlugin { const commands = createJqCommands(options); return {name: "jq-commands", setup(host) { for(const command of commands) host.commands.register(command,{replace:options.replace??false}); } }; }
