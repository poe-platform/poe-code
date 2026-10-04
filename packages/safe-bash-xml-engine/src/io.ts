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
  const decoder = new TextDecoder("utf-8", { fatal: true });
  const decode = (bytes?: Uint8Array) => {
    try { return bytes ? decoder.decode(bytes, { stream: true }) : decoder.decode(); }
    catch { throw new XmlQueryError("XML input must be UTF-8", 1); }
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
