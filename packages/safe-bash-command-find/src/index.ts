import type { CommandDefinition,CommandHandler,VirtualShellPlugin } from "safe-bash-contracts";
import { FsError } from "safe-bash-contracts";
import { createFindDefinitions } from "./find.js";
export interface FindLimits { readonly maxDirectoryEntries: number; }
export interface FindCommandsOptions { readonly replace?: boolean; readonly limits?: Partial<FindLimits>; readonly execute?: CommandHandler; }
export function createFindCommands(options: FindCommandsOptions = {}): readonly CommandDefinition[] {
 return createFindDefinitions(options.execute ?? (context => {
  if (!context.invoke) throw new FsError("ENOTSUP", { syscall: "find", message: "find -exec requires command invocation" });
  return context.invoke(context.command, context.args, {
    ...(context.argumentValues === undefined ? {} : { argumentValues: context.argumentValues }),
    signal: context.signal, stdin: context.stdin, stdout: context.stdout, stderr: context.stderr,
    cwd: context.cwd, env: context.env, replaceEnv: true,
  });
 }), options.limits?.maxDirectoryEntries);
}
export function createFindCommand(options: FindCommandsOptions = {}): CommandDefinition { return createFindCommands(options)[0]!; }
export function findCommands(options: FindCommandsOptions = {}): VirtualShellPlugin {
 const commands = createFindCommands(options);
 return { name: "find-commands", setup(host) {
 if (!options.replace) for (const command of commands) if (host.commands.has(command.name)) throw new Error(`Command already registered: ${command.name}`);
 for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
 } };
}
export { evalSyncFind } from "./find.js";
