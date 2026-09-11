import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { grepCommands } from "../grep.js";
import type { RegexExecutionOptions } from "../regex-execution/protocol.js";
import type { BoundedRegexProvider } from "../regex-execution/provider.js";

export interface GrepAliasOptions {
  readonly regex?: RegexExecutionOptions;
  readonly regexExecutor?: BoundedRegexProvider;
  readonly replace?: boolean;
}

import { alias, createGrepAliases } from "./aliases.js";

export function createGrepAliasCommands(options: GrepAliasOptions = {}): readonly CommandDefinition[] {
  const grep = grepCommands({ ...options.regex, ...(options.regexExecutor === undefined ? {} : { regexExecutor: options.regexExecutor }) })[0]!;
  return createGrepAliases(grep);
}

export function egrepCommand(options: GrepAliasOptions = {}): CommandDefinition {
  return alias("egrep", grepCommands({ ...options.regex, ...(options.regexExecutor === undefined ? {} : { regexExecutor: options.regexExecutor }) })[0]!);
}

export function fgrepCommand(options: GrepAliasOptions = {}): CommandDefinition {
  return alias("fgrep", grepCommands({ ...options.regex, ...(options.regexExecutor === undefined ? {} : { regexExecutor: options.regexExecutor }) })[0]!);
}

export function grepAliasCommands(options: GrepAliasOptions = {}): VirtualShellPlugin {
  return {
    name: "grep-alias-commands",
    setup(host) {
      const definitions = createGrepAliasCommands(options);
      if (!options.replace) for (const definition of definitions) {
        if (host.commands.has(definition.name)) throw new Error(`Command already registered: ${definition.name}`);
      }
      for (const definition of definitions) host.commands.register(definition, { replace: options.replace ?? false });
    },
  };
}
