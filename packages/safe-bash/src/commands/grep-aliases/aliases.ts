import type { CommandDefinition } from "../../contracts/index.js";

export function alias(name: "egrep" | "fgrep", grep: CommandDefinition): CommandDefinition {
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


export function createGrepAliases(grep: CommandDefinition): readonly CommandDefinition[] {
  return [alias("egrep", grep), alias("fgrep", grep)];
}
