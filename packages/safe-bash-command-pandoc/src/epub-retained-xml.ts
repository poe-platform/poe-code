import {openRetainedXmlDocument, type RetainedXmlDocument} from "@poe-code/office-xml/retained-xml-document";
import {characters} from "@poe-code/office-xml/retained-values";
import {PandocError} from "./errors.js";
import type {AdapterContext} from "./types.js";

type Source = AsyncIterable<Uint8Array> | Iterable<Uint8Array>;

/** EPUB-specific ownership and budget boundary around the shared retained XML
 * index. The returned document remains enrolled in the conversion lifetime. */
export async function openEpubXml(source: Source, part: string, context: AdapterContext): Promise<RetainedXmlDocument> {
  const working = context.workingFiles, cache = working?.cacheBytes ?? 1024 * 1024;
  const fail = (code: "E_OPTION" | "E_CAPABILITY" | "E_PARSE" | "E_ENCODING" | "E_IO", message: string): never => {throw new PandocError(code, context.operation ?? "read", message, "epub", part);};
  if (!working) return fail("E_CAPABILITY", "Retained EPUB XML requires caller working storage");
  if (!Number.isSafeInteger(cache) || cache < 16384 || cache % 16384 || !working.directory.startsWith("/")) return fail("E_OPTION", "Invalid working storage configuration");
  const lifetime = new AbortController();
  const signal = context.signal ? AbortSignal.any([context.signal, lifetime.signal]) : lifetime.signal;
  let document: RetainedXmlDocument | undefined, iterator: AsyncIterator<Uint8Array> | Iterator<Uint8Array> | undefined;
  let opening: Promise<RetainedXmlDocument> | undefined;
  let done = false, closing: Promise<void> | undefined, inputFailure: {reason: unknown} | undefined;
  const closeSource = async () => {if (!done) {done = true; await iterator?.return?.();}};
  let releaseDocument: (() => void) | undefined, releaseSource: (() => void) | undefined;
  const close = () => closing ??= (async () => {
    lifetime.abort();
    try {
      const outcomes = await Promise.allSettled([closeSource(), (async () => {
        // Retirement may start before the index has returned its owned handle.
        const acquired = document ?? await opening?.catch(() => undefined);
        await acquired?.close();
      })()]);
      const failure = outcomes.find(outcome => outcome.status === "rejected");
      if (failure?.status === "rejected") throw failure.reason;
    } finally {releaseDocument?.(); releaseSource?.();}
  })();
  try {
    releaseDocument = context.onClose?.(close);
    releaseSource = context.onClose?.(closeSource);
    iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
    context.checkpoint();
    // XML parts are processed serially. A single page per XML store avoids
    // reserving the caller's entire general cache twice for every small part.
    const xmlCacheBytes = 16384;
    context.charge("retainedBytes", xmlCacheBytes * 2 + 8192);
    const owned = (async function* () {
      const decoder = new TextDecoder("utf-8", {fatal: true}), encoder = new TextEncoder();
      const decode = (bytes?: Uint8Array) => {
        try {return bytes === undefined ? decoder.decode() : decoder.decode(bytes, {stream: true});}
        catch {return fail("E_ENCODING", "Invalid or incomplete UTF-8 sequence");}
      };
      try {
        while (!done) {
          context.checkpoint();
          const next = await iterator!.next(); context.checkpoint();
          if (next.done) {done = true; break;}
          if (!(next.value instanceof Uint8Array)) throw new PandocError("E_IO", context.operation ?? "read", "Producer must yield bytes");
          for (let offset = 0; offset < next.value.length; offset += 256) {
            const decoded = decode(next.value.subarray(offset, offset + 256));
            context.charge("text", decoded.length);
            if (decoded) yield encoder.encode(decoded);
            await context.cooperate();
          }
          await context.cooperate(0);
        }
        const tail = decode(); context.charge("text", tail.length); if (tail) yield encoder.encode(tail);
      } catch (reason) {inputFailure = {reason}; throw reason;}
      finally {await closeSource().catch(reason => {if (!inputFailure) {inputFailure = {reason}; throw reason;}});}
    })();
    opening = openRetainedXmlDocument(owned, {workingStorage: {...working, cacheBytes: xmlCacheBytes}, signal});
    document = await opening;
    releaseSource?.(); releaseSource = undefined;
    const units = async (source: AsyncIterable<Uint8Array>) => {let count = 0, window = 0; for await (const character of characters(source)) {count += character.length; window += character.length; if (window >= 4096) {window = 0; await context.cooperate();}} return count;};
    for await (const {node, depth} of document.nodes()) {
      await context.cooperate();
      if (node.kind === "text" || node.kind === "cdata") {context.charge("xmlNodes", 1); context.charge("retainedBytes", 2 * await units(document.text(node))); continue;}
      if (node.kind !== "element") continue;
      context.bound("xmlDepth", depth!); context.charge("xmlNodes", 1);
      let attributeCount = 0;
      for (const attributes of [document.attributes(node), document.declarations(node)]) for await (const ignoredAttribute of attributes) {attributeCount++; await context.cooperate();}
      context.charge("attributes", attributeCount); context.charge("retainedBytes", 128);
      context.charge("retainedBytes", 2 * (await units(document.raw(node.localName)) + await units(document.namespace(node))));
      for (const attributes of [document.attributes(node), document.declarations(node)]) for await (const attribute of attributes) {
        context.charge("retainedBytes", 64);
        context.charge("retainedBytes", 2 * (await units(document.raw(attribute.localName)) + await units(document.namespace(attribute)) + await units(document.text(attribute))));
      }
    }
    return {...document, close};
  } catch (error) {
    await close().catch(() => {});
    if (inputFailure) throw inputFailure.reason;
    if (error instanceof PandocError) throw error;
    context.checkpoint();
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "io-failure") return fail("E_IO", "EPUB XML backing operation failed");
      if (error.code === "invalid-xml") return fail("E_PARSE", "Invalid EPUB XML");
      if (error.code === "cancelled") throw new PandocError("E_CANCELLED", context.operation ?? "read", "Conversion cancelled");
    }
    throw error;
  }
}
