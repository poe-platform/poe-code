import { readFileStream } from "safe-bash-contracts/filesystem";
import {
  readBytes,
  type ByteSource,
  type CommandContext
} from "safe-bash-contracts";
import { XmlBudget, XmlQueryLimitError, XmlQueryError } from "./limits.js";

export interface XmlCommandRuntime {
  readonly yieldTurn: (signal: AbortSignal) => Promise<void>;
  readonly pathOf: (context: Pick<CommandContext, "cwd">, path: string) => string;
  readonly interruptible: <Result>(
    operation: () => PromiseLike<Result>,
    signal: AbortSignal
  ) => Promise<Result>;
  readonly writeDiagnostic: (
    sink: CommandContext["stderr"],
    value: string,
    signal?: AbortSignal
  ) => Promise<void>;
}

export async function* readXmlChunks(
  context: CommandContext,
  file: string | undefined,
  budget: XmlBudget,
  runtime: XmlCommandRuntime
): AsyncGenerator<string> {
  const remainingBytes = Math.max(0, Math.min(
    budget.limits.maxInputBytes,
    context.inputBudget?.maxBytes ?? Infinity
  ) - budget.inputBytes);
  let source: ByteSource = context.stdin;
  if (file !== undefined && file !== "-") {
    const path = runtime.pathOf(context, file);
    source = readFileStream(context.fs, path, { signal: context.signal,
      chunkSize: Math.max(1, Math.min(65536, remainingBytes)),
    });
  }
  budget.inputEncoding = "UTF-8";
  let decoder: TextDecoder | undefined;
  let pending = "";
  let latin1 = false;
  const decode = (bytes?: Uint8Array) => {
    try {
      let offset = 0;
      if (!decoder) {
        while (offset < (bytes?.length ?? 0)) {
          pending += String.fromCharCode(bytes![offset++]!);
          if (pending.length === 1 && (pending.charCodeAt(0) === 0xff || pending.charCodeAt(0) === 0xfe)) continue;
          if (pending.charCodeAt(0) === 0xff && pending.charCodeAt(1) === 0xfe) {
            budget.inputEncoding = "UTF-16LE";
            break;
          }
          if (pending.charCodeAt(0) === 0xfe && pending.charCodeAt(1) === 0xff) {
            budget.inputEncoding = "UTF-16BE";
            break;
          }
          if ("<?xml".startsWith(pending)) continue;
          if (!pending.startsWith("<?xml") || !" \t\r\n".includes(pending[5]!)) break;
          if (!pending.endsWith("?>")) continue;
          // Read declaration attributes before decoding any document content.
          let at = 5;
          while (at < pending.length - 2) {
            while (" \t\r\n".includes(pending[at] ?? "") && at < pending.length) at++;
            const start = at;
            while (at < pending.length && !"= \t\r\n?".includes(pending[at]!)) at++;
            const name = pending.slice(start, at);
            while (" \t\r\n".includes(pending[at] ?? "") && at < pending.length) at++;
            if (pending[at++] !== "=") break;
            while (" \t\r\n".includes(pending[at] ?? "") && at < pending.length) at++;
            const quote = pending[at++];
            if (quote !== "'" && quote !== '"') break;
            const end = pending.indexOf(quote, at);
            if (end < 0) break;
            if (name === "encoding") budget.inputEncoding = pending.slice(at, end);
            at = end + 1;
          }
          break;
        }
        if (bytes && offset === bytes.length &&
          ("<?xml".startsWith(pending) ||
           (pending.startsWith("<?xml") && " \t\r\n".includes(pending[5]!) && !pending.endsWith("?>")) ||
           (pending.length === 1 && (pending.charCodeAt(0) === 0xff || pending.charCodeAt(0) === 0xfe)))) return "";
        decoder = new TextDecoder(budget.inputEncoding, { fatal: true });
        // WHATWG maps Latin-1 to Windows-1252; XML needs the actual byte values.
        latin1 = ["iso-8859-1", "latin1"].includes(budget.inputEncoding.toLowerCase());
        const prefix = latin1 ? pending : decoder.decode(Uint8Array.from(pending, c => c.charCodeAt(0)), { stream: true });
        pending = "";
        const rest = bytes?.subarray(offset);
        return prefix + (latin1 ? (rest ? String.fromCharCode(...rest) : "")
          : rest ? decoder.decode(rest, { stream: true }) : decoder.decode());
      }
      return latin1 ? (bytes ? String.fromCharCode(...bytes) : "")
        : bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode();
    } catch { throw new XmlQueryError(`XML input must be valid ${budget.inputEncoding}`, 1); }
  };
  let chunksSinceYield = 0;
  for await (const chunk of readBytes(source, context.signal)) {
    const checkpoint = budget.tick();
    chunksSinceYield++;
    if (checkpoint) {
      await checkpoint;
      chunksSinceYield = 0;
    } else if (chunksSinceYield >= 1024) {
      // Empty/tiny chunks must yield independently of parser work batching.
      await runtime.yieldTurn(context.signal);
      chunksSinceYield = 0;
    }
    budget.inputBytes += chunk.byteLength;
    context.inputBudget?.check(budget.inputBytes);
    if (budget.inputBytes > budget.limits.maxInputBytes)
      throw new XmlQueryLimitError("maxInputBytes");
    // Decode before requesting another chunk; a producer may reuse its backing bytes.
    for (let offset = 0; offset < chunk.length; offset += 4096) {
      await budget.tick(Math.min(4096, chunk.length - offset));
      yield decode(chunk.subarray(offset, offset + 4096));
    }
  }
  yield decode();
}

/** Buffering convenience API for callers that explicitly require complete text. */
export async function readXmlInput(
  context: CommandContext,
  file: string | undefined,
  budget: XmlBudget,
  runtime: XmlCommandRuntime
): Promise<string> {
  const parts: string[] = [];
  for await (const part of readXmlChunks(context, file, budget, runtime)) parts.push(part);
  return parts.join("");
}
