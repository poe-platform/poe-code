import type { CommandContext, CommandHandler } from "safe-bash-contracts";
import type { CommandArguments } from "safe-bash-contracts/command";
import { byteLength } from "safe-bash-io-engine/byte-encoding";
import { replaceArgument, UsageError } from "safe-bash-io-engine/internal";

/** Keep literal byte arguments paired with their canonical carrier in each child. */
export function createFindInvocation(context: CommandContext, execute: CommandHandler,
  commandArguments: CommandArguments, command: string[], terminator: string,
  flushes: (() => Promise<void>)[], onFailure: () => void): (entry: { readonly display: string }) => Promise<boolean> {
  if (terminator === ";") return async entry => {
    const invocation = commandArguments.withValues(commandArguments.values.map((argument, index) => replaceArgument(typeof argument === "string" ? argument : commandArguments.bytes(index)!, "{}", entry.display)));
    const childArguments = invocation.slice(1);
    return (await execute({ ...context, command: invocation.args[0]!, args: childArguments.args, argumentValues: childArguments, env: { ...context.env } })).exitCode === 0;
  };
  if (command.at(-1) !== "{}" || command.slice(0, -1).some(argument => argument.includes("{}"))) throw new UsageError("batched -exec requires exactly one final '{}' argument");
  const pending: string[] = [];
  let bytes = 0;
  const flush = async () => {
    if (!pending.length) return;
    const childArguments = commandArguments.withValues([...commandArguments.values.slice(1, -1), ...pending]);
    const result = await execute({ ...context, command: command[0]!, args: childArguments.args, argumentValues: childArguments, env: { ...context.env } });
    if (result.exitCode !== 0) onFailure();
    pending.length = 0; bytes = 0;
  };
  flushes.push(flush);
  return async entry => {
    const size = byteLength(entry.display) + 1;
    if (pending.length >= 1000 || bytes + size > 65536) await flush();
    pending.push(entry.display); bytes += size; return true;
  };
}
