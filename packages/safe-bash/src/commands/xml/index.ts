export * from "safe-bash-command-xmllint";
export { createXmllintCommand, createXmllintCommands, xmllintCommands } from "safe-bash-command-xmllint";
import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { createXmllintCommand } from "safe-bash-command-xmllint";
import { createXqCommand } from "safe-bash-command-xq";
import type { XmlCommandsOptions } from "safe-bash-xml-engine/limits";
export function createXmlCommands(options: XmlCommandsOptions = {}): readonly CommandDefinition[] { return [createXqCommand(options), createXmllintCommand(options)]; }
export function xmlCommands(options: XmlCommandsOptions = {}): VirtualShellPlugin { const commands = createXmlCommands(options); return {name: "xml-commands", setup(host) { if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`); for(const command of commands) host.commands.register(command,{replace:options.replace??false}); } }; }
export { evalSyncXq } from "safe-bash-command-xq";
