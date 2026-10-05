import type {CommandContext} from "safe-bash-contracts";
import {pipeBytes} from "safe-bash-contracts";
import {writeDiagnostic} from "safe-bash-contracts/escaping";
import {yieldTurn} from "safe-bash-contracts/yield";
import {LlmCancelToolCall, type LlmToolExecutionOptions} from "./tool-execution.js";
import {waitForSource} from "./request-source.js";
import {pythonRepr} from "./python-repr.js";

/** The command's stdin is the only approval authority. No ambient host input. */
export function createToolApproval(options: {
  context: CommandContext;
  openInput(): Promise<AsyncIterator<Uint8Array>>;
  write(bytes: Uint8Array): Promise<void>;
  admitInput(bytes: number): void;
}): NonNullable<LlmToolExecutionOptions["beforeCall"]> {
  const {context, write, admitInput} = options, {signal} = context;
  const encoder = new TextEncoder();
  let iterator: AsyncIterator<Uint8Array> | undefined, pending: Uint8Array = new Uint8Array(0), position = 0, ended = false, skipLineFeed = false;
  const whitespace = (char: string) => char !== "\ufeff" && (!char.trim() || ["\u001c", "\u001d", "\u001e", "\u001f", "\u0085"].includes(char));
  const answer = async (): Promise<string | undefined> => {
    const decoder = new TextDecoder("utf-8", {fatal: true});
    let value = "", seen = false, trailing = false, invalid = false, steps = 0;
    const accept = (text: string): void => {
      for (const char of text) {
        if (whitespace(char)) {if (value) trailing = true;}
        else if (trailing || value.length >= 3) invalid = true;
        else value += char.toLowerCase();
      }
    };
    while (true) {
      if (++steps % 256 === 0) await yieldTurn(signal);
      signal.throwIfAborted();
      if (position === pending.length) {
        if (ended) {accept(decoder.decode()); return seen ? invalid ? "invalid" : value : undefined;}
        iterator ??= await options.openInput();
        const next = await waitForSource(() => iterator!.next(), signal);
        if (next.done) {ended = true; continue;}
        if (!(next.value instanceof Uint8Array)) throw new TypeError("Byte sources must yield Uint8Array chunks");
        admitInput(next.value.length); pending = next.value; position = 0;
        continue;
      }
      if (skipLineFeed) {skipLineFeed = false; if (pending[position] === 10) {position++; continue;}}
      seen = true;
      const end = Math.min(pending.length, position + 4096);
      let newline = position;
      while (newline < end && pending[newline] !== 10 && pending[newline] !== 13) newline++;
      accept(decoder.decode(pending.subarray(position, newline), {stream: true}));
      position = newline;
      if (newline < end) {skipLineFeed = pending[position] === 13; position++; accept(decoder.decode()); return invalid ? "invalid" : value;}
    }
  };
  return async (_tool, call) => {
    await writeDiagnostic(context.stderr, `Tool call: ${call.name}(`, signal);
    await pipeBytes(pythonRepr(call.arguments, signal), context.stderr, signal);
    await writeDiagnostic(context.stderr, ")\n", signal);
    while (true) {
      await write(encoder.encode("Approve tool call? [y/N]: "));
      const value = await answer();
      if (value === undefined) throw new Error("");
      if (value === "y" || value === "yes") return;
      if (value === "" || value === "n" || value === "no") throw new LlmCancelToolCall("User cancelled tool call");
      await write(encoder.encode("Error: invalid input\n"));
    }
  };
}
