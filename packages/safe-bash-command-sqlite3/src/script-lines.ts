import { retainInput } from "./retained-input.js";
import type { ByteSource, CommandContext } from "safe-bash-contracts";

/** Only the current decoded line is handed to the SQL statement parser. */
export async function* stagedScriptLines(source: ByteSource, context: CommandContext,
  account: (bytes: number) => void): AsyncGenerator<string> {
  const input = await retainInput(source, context, account);
  let failed = false, pending = "";
  try {
    for await (const text of input.text()) {
      let from = 0;
      for (let at = text.indexOf("\n"); at >= 0; at = text.indexOf("\n", from)) {
        const line = pending + text.slice(from, at); pending = "";
        context.signal.throwIfAborted();
        yield line.endsWith("\r") ? line.slice(0, -1) : line;
        from = at + 1;
      }
      pending += text.slice(from);
    }
    context.signal.throwIfAborted(); yield pending;
  } catch (error) { failed = true; throw error; } finally {
    await input.close().catch(error => { if (!failed) throw error; });
  }
}
