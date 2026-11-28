import type { CommandContext, CommandHandler } from "safe-bash-contracts";
import { basename, dirname, normalizePath } from "safe-bash-contracts";
import type { CommandArguments } from "safe-bash-contracts/command";
import { byteLength } from "safe-bash-io-engine/byte-encoding";
import { replaceArgument, UsageError } from "safe-bash-io-engine/internal";

/** Keep literal byte arguments paired with their canonical carrier in each child. */
export function createFindInvocation(context: CommandContext, execute: CommandHandler,
  commandArguments: CommandArguments, command: string[], terminator: string,
  flushes: (() => Promise<void>)[], onFailure: () => void, execdir = false): (entry: { readonly display: string; readonly path: string }) => Promise<boolean> {
  if (terminator === ";") return async entry => {
    const display = execdir ? `./${basename(entry.path) || "."}` : entry.display;
    const invocation = commandArguments.withValues(commandArguments.values.map((argument, index) => replaceArgument(typeof argument === "string" ? argument : commandArguments.bytes(index)!, "{}", display)));
    const childArguments = invocation.slice(1);
    return (await execute({ ...context, cwd: execdir ? normalizePath(dirname(entry.path)) : context.cwd, command: invocation.args[0]!, args: childArguments.args, argumentValues: childArguments, env: { ...context.env } })).exitCode === 0;
  };
  if (command.at(-1) !== "{}" || command.slice(0, -1).some(argument => argument.includes("{}"))) throw new UsageError("batched -exec requires exactly one final '{}' argument");
  const pending: string[] = [];
  let bytes = 0;
  let cwd = context.cwd;
  const flush = async () => {
    if (!pending.length) return;
    const childArguments = commandArguments.withValues([...commandArguments.values.slice(1, -1), ...pending]);
    const result = await execute({ ...context, cwd, command: command[0]!, args: childArguments.args, argumentValues: childArguments, env: { ...context.env } });
    if (result.exitCode !== 0) onFailure();
    pending.length = 0; bytes = 0;
  };
  flushes.push(flush);
  return async entry => {
    const directory = execdir ? normalizePath(dirname(entry.path)) : context.cwd;
    const display = execdir ? `./${basename(entry.path) || "."}` : entry.display;
    const size = byteLength(display) + 1;
    if (directory !== cwd || pending.length >= 1000 || bytes + size > 65536) await flush();
    cwd = directory;
    pending.push(display); bytes += size; return true;
  };
}
