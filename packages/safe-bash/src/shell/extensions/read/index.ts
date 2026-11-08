import { commandRuntimeIdentity } from "../../../contracts/command.js";
import type { ShellExtension } from "../../extensions.js";
import { executeRead } from "../../read-builtin.js";

export interface ReadExtensionOptions {
  readonly nonTerminalInput?: boolean;
}

export function readExtension(options: ReadExtensionOptions = {}): ShellExtension {
  const nonTerminalInput = options.nonTerminalInput === true;
  return { name: "extended-read", runtimeIdentity: commandRuntimeIdentity, create: () => ({
    builtins: [{ name: "read", replace: true, execute: executeRead.bind(undefined, nonTerminalInput) }],
  }) };
}
