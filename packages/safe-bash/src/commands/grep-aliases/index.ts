import type { CommandDefinition, VirtualShellPlugin } from "../../contracts/index.js";
import { grepCommands } from "../grep.js";
import type { RegexExecutionOptions } from "../regex-execution/protocol.js";

export interface GrepAliasOptions {
  readonly regex?: RegexExecutionOptions;
  readonly replace?: boolean;
}

function alias(name: "egrep" | "fgrep", grep: CommandDefinition): CommandDefinition {
  return {
    name,
    execute: context => {
      const stdinIsDefault = context.stdinIsDefault;
      const invoke = context.invoke;
      const registerCleanup = context.registerCleanup;
      return grep.execute({
        ...context,
        command: name,
        args: [name === "egrep" ? "-E" : "-F", ...context.args],
        stdin: context.stdin,
        stdout: context.stdout,
        stderr: context.stderr,
        cwd: context.cwd,
        env: context.env,
        fs: context.fs,
        signal: context.signal,
        ...(stdinIsDefault === undefined ? {} : { stdinIsDefault }),
        ...(invoke === undefined ? {} : { invoke: invoke.bind(context) }),
        ...(registerCleanup === undefined ? {} : { registerCleanup: registerCleanup.bind(context) }),
      });
    },
  };
}

export function createGrepAliasCommands(options: GrepAliasOptions = {}): readonly CommandDefinition[] {
  const grep = grepCommands(options.regex)[0]!;
  return [alias("egrep", grep), alias("fgrep", grep)];
}

export function egrepCommand(options: GrepAliasOptions = {}): CommandDefinition {
  return alias("egrep", grepCommands(options.regex)[0]!);
}

export function fgrepCommand(options: GrepAliasOptions = {}): CommandDefinition {
  return alias("fgrep", grepCommands(options.regex)[0]!);
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
