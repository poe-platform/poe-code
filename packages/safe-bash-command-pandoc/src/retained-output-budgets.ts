import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions} from "./types.js";

/** Replay native text finalization without retaining the output. Source chunks
 * preserve Unicode scalar boundaries and can be replayed from caller storage. */
export async function reserveRetainedOutput(source: () => AsyncIterable<string>, context: ExecutionContext, eol: ConversionOptions["eol"]): Promise<void> {
  if (!Number.isFinite(context.limits.references)) return;
  if (eol === "crlf") {
    let units = 0;
    for await (const chunk of source()) for (const char of chunk) {
      units += char === "\n" ? 2 : char.length;
      context.bound("outputBytes", units); context.charge("references", 1);
    }
  }
  if (Number.isFinite(context.limits.outputBytes)) {
    let length = 0;
    for await (const chunk of source()) for (const char of chunk) {
      if (eol === "crlf" && char === "\n") context.bound("outputBytes", ++length);
      const code = char.codePointAt(0)!;
      length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
      context.bound("outputBytes", length);
    }
  }
}
