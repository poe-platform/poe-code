import { StoredParserAttributes } from "./parser-attributes.js";
import { StoredStringMap as StoredNamespaces } from "./stored-map.js";
import { StoredXmlFrames } from "./frames.js";
import { normalizeXmlChunks, parseXmlSourceSteps, type XmlElement, type XmlAttribute, type XmlSourceRead } from "@poe-code/safe-fs/core";
import { PagedStorage, PagedStorageCache, type PagedStorageContext } from "@poe-code/safe-fs/storage";
import { XmlBudget } from "./limits.js";

type XmlEvent = Parameters<NonNullable<NonNullable<Parameters<typeof parseXmlSourceSteps>[1]>["events"]>>[0]
  | { type: "attribute"; attribute: XmlAttribute; element: XmlElement; continuation?: boolean };

/** Parse lazy input, or prevalidated recovery input, through a shared 64 KiB source/frame cache.
 * The parser retains only its current source window, tokens and the current frame. */
export async function parseStoredXml(
  source: AsyncIterable<string> | Iterable<string>,
  context: PagedStorageContext & { readonly registerCleanup?: (cleanup: () => Promise<void>) => void },
  budget: XmlBudget,
  recover?: (message: string) => void,
  consume?: (event: XmlEvent, namespaceParts: (reference: number) => AsyncIterable<string>) => Promise<void>,
  deferNamespaces = false,
): Promise<XmlElement> {
  const cache = new PagedStorageCache(4);
  const storage = new PagedStorage(context, 4, cache);
  const frameStorage = recover ? storage : new PagedStorage(context, 4, cache);
  const input = normalizeXmlChunks(source, !recover);
  let sourceDone = false;
  try {
    context.registerCleanup?.(storage.close.bind(storage));
    if (frameStorage !== storage) context.registerCleanup?.(frameStorage.close.bind(frameStorage));
    const start = storage.allocate(0);
    let length = 0;
    async function readNext(): Promise<void> {
      const next = await input.next();
      if (next.done) { sourceDone = true; return; }
      const chunk = next.value;
      const bytes = new Uint8Array(chunk.length * 2), view = new DataView(bytes.buffer);
      for (let index = 0; index < chunk.length; index++) view.setUint16(index * 2, chunk.charCodeAt(index), true);
      await storage.append(bytes);
      length += chunk.length;
      // Match the buffered parser: an astral pair may extend a 512-unit window.
      const checkpoint = budget.tick(Math.min(chunk.length, 512)); if (checkpoint) await checkpoint;
    }
    if (recover) while (!sourceDone) await readNext();
    async function completeSourceRead(request: XmlSourceRead): Promise<void> {
      while (length <= request.offset && !sourceDone) await readNext();
      const count = Math.min(request.length, Math.max(0, length - request.offset));
      const bytes = await storage.read(start + request.offset * 2, count * 2);
      const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const units = new Uint16Array(count);
      for (let index = 0; index < units.length; index++) units[index] = view.getUint16(index * 2, true);
      request.value = String.fromCharCode(...units);
      if (request.streaming) request.complete = sourceDone && request.offset + count === length;
    }
    const queued: XmlEvent[] = [];
    const frames = new StoredXmlFrames(frameStorage);
    const attributes = new StoredParserAttributes(frameStorage, budget);
    const parser = parseXmlSourceSteps(recover ? length : undefined, {
      ...budget.limits, deferNamespaces, maxContentNodes: budget.limits.maxNodes, expectedEncoding: "UTF-8", retainTree: false, storeFrames: true, storeNamespaces: true, storeAttributes: true, fragmentAttributes: true, fragmentContent: true, compactDeclaration: true,
      ...(recover ? { recover } : {}), ...(consume ? { events: (event: XmlEvent) => { queued.push(event); }, onAttribute: (attribute: XmlAttribute, element: XmlElement, continuation = false) => { queued.push({ type: "attribute", attribute, element, continuation }); } } : {}),
    });
    let step = parser.next();
    try {
      while (true) {
        for (const event of queued) await consume!(event, reference => new StoredNamespaces(frameStorage, budget).valueParts(reference));
        queued.length = 0;
        if (step.done) { await frameStorage.close(); await storage.close(); return step.value; }
        if (typeof step.value === "number") {
          const checkpoint = budget.tick(step.value); if (checkpoint) await checkpoint;
        } else if ("attributeOperation" in step.value) {
          await attributes.execute(step.value);
        } else if ("namespaceOperation" in step.value) {
          const request = step.value;
          const scope = new StoredNamespaces(frameStorage, budget, request.scope.reference);
          if (request.namespaceOperation === "reference") {
            const reference = await scope.lookup(request.prefix);
            if (reference !== undefined) request.reference = reference;
            request.complete = true;
          } else if (request.namespaceOperation === "has") {
            request.found = await scope.lookup(request.prefix) !== undefined;
          } else if (request.namespaceOperation === "get") {
            const previous = await scope.get(request.prefix);
            if (previous !== undefined) request.value = previous;
            request.complete = true;
          } else {
            const previous = await scope.lookup(request.prefix);
            const value = request.value;
            const parts = typeof value === "string" ? value : (async function* () {
              for (const part of value) {
                if (typeof part === "string") yield part;
                else if (typeof part === "number") { const checkpoint = budget.tick(part); if (checkpoint) await checkpoint; }
                else await completeSourceRead(part);
              }
            })();
            const next = await scope.set(request.prefix, parts);
            request.result = { reference: next.reference, size: request.scope.size + (previous === undefined ? 1 : 0) };
          }
        } else if ("frameOperation" in step.value) {
          await frames.execute(step.value);
        } else {
          await completeSourceRead(step.value);
        }
        step = parser.next();
      }
    } finally { if (!step.done) parser.return(undefined as never); }
  } catch (error) {
    try { if (!sourceDone) await input.return(undefined); }
    catch { /* Preserve the parser, input or cancellation failure. */ }
    try { await frameStorage.close(); }
    catch { /* Close the source even if frame retirement fails. */ }
    try { await storage.close(); }
    catch { /* Preserve the parser, input or cancellation failure. */ }
    throw error;
  }
}

export { parseStoredXml as parseXmlRecovery };
