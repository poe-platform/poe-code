import { SsconvertError, type CapabilityContext } from "../contracts.js";
import { encodeText } from "./encode.js";

/** Encode a continuous text stream with one BOM and bounded conversion scratch.
 * Raw native byte fields are permitted only by the caller's UTF-8 codec contract. */
export async function* encodeTextStream(source: AsyncIterable<string | Uint8Array>, charset: string,
  transliterate: boolean, context: CapabilityContext): AsyncGenerator<Uint8Array> {
  const prefix = encodeText("", charset, transliterate, context);
  let size = prefix.length, pending = "";
  const encode = (text: string) => {
    // Every supported encoding is stateless apart from its BOM. A trailing high
    // surrogate stays in pending so fragment boundaries cannot change scalars.
    const bytes = encodeText(text, charset, transliterate, {
      ...context, limits: { ...context.limits, outputBytes: context.limits.outputBytes - size + prefix.length }
    }).subarray(prefix.length);
    size += bytes.length;
    return bytes;
  };
  if (prefix.length) yield prefix;
  for await (const chunk of source) {
    context.signal.throwIfAborted();
    if (chunk instanceof Uint8Array) {
      if (pending) { yield encode(pending); pending = ""; }
      if (chunk.length > context.limits.outputBytes - size)
        throw new SsconvertError("resource-limit", "ssconvert output bytes limit exceeded");
      size += chunk.length;
      for (let offset = 0; offset < chunk.length; offset += 64 * 1024) {
        context.signal.throwIfAborted();
        yield chunk.subarray(offset, offset + 64 * 1024);
      }
      continue;
    }
    for (let offset = 0; offset < chunk.length;) {
      context.signal.throwIfAborted();
      const take = Math.min(16384 - pending.length, chunk.length - offset);
      pending += chunk.slice(offset, offset + take); offset += take;
      if (pending.length < 16384) continue;
      const last = pending.charCodeAt(pending.length - 1);
      const end = last >= 0xd800 && last <= 0xdbff ? pending.length - 1 : pending.length;
      const bytes = encode(pending.slice(0, end));
      pending = pending.slice(end);
      if (bytes.length) yield bytes;
    }
  }
  context.signal.throwIfAborted();
  if (pending) yield encode(pending);
}
