import {
  FsError,
  readBytes,
  toByteSource,
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

export async function readXmlInput(
  context: CommandContext,
  file: string | undefined,
  budget: XmlBudget,
  runtime: XmlCommandRuntime
): Promise<string> {
  let source: ByteSource = context.stdin;
  if (file !== undefined && file !== "-") {
    const path = runtime.pathOf(context, file);
    const capabilities = context.fs.capabilitiesFor
      ? await runtime.interruptible(
          () => context.fs.capabilitiesFor!(path, { signal: context.signal }),
          context.signal
        )
      : context.fs.capabilities;
    context.signal.throwIfAborted();
    if (context.fs.readStream && capabilities.streamingRead !== false)
      source = context.fs.readStream(path, { signal: context.signal });
    else {
      try {
        source = toByteSource(
          await runtime.interruptible(
            () =>
              context.fs.readFile(path, {
                signal: context.signal,
                ...(Number.isFinite(budget.limits.maxInputBytes)
                  ? { maxBytes: budget.limits.maxInputBytes }
                  : {})
              }),
            context.signal
          )
        );
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof FsError && error.code === "EFBIG")
          throw new XmlQueryLimitError("maxInputBytes");
        throw error;
      }
    }
  }
  const parts: string[] = [];
  const decoder = new TextDecoder("utf-8", { fatal: true });
  for await (const chunk of readBytes(source, context.signal)) {
    await budget.tick();
    budget.inputBytes += chunk.byteLength;
    if (budget.inputBytes > budget.limits.maxInputBytes)
      throw new XmlQueryLimitError("maxInputBytes");
    // Decode before requesting another chunk; a producer may reuse its backing bytes.
    for (let offset = 0; offset < chunk.length; offset += 4096) {
      await budget.tick(Math.min(4096, chunk.length - offset));
      try {
        parts.push(decoder.decode(chunk.subarray(offset, offset + 4096), { stream: true }));
      } catch {
        throw new XmlQueryError("XML input must be UTF-8", 1);
      }
    }
  }
  try {
    parts.push(decoder.decode());
  } catch {
    throw new XmlQueryError("XML input must be UTF-8", 1);
  }
  return parts.join("");
}
