import { StoredXmlFrames } from "./frames.js";
import { normalizeXmlChunks, parseXmlSourceSteps, type XmlElement } from "@poe-code/safe-fs/core";
import { PagedStorage, type PagedStorageContext } from "@poe-code/safe-fs/storage";
import { XmlBudget } from "./limits.js";

type XmlEvent = Parameters<NonNullable<NonNullable<Parameters<typeof parseXmlSourceSteps>[1]>["events"]>>[0];

/** Validate and replay recovery input through a 64 KiB caller-backed source cache.
 * The parser retains only its current source window, tokens and the current frame. */
export async function parseXmlRecovery(
  source: AsyncIterable<string> | Iterable<string>,
  context: PagedStorageContext & { readonly registerCleanup?: (cleanup: () => Promise<void>) => void },
  budget: XmlBudget,
  recover: (message: string) => void,
  consume?: (event: XmlEvent) => Promise<void>,
): Promise<XmlElement> {
  const storage = new PagedStorage(context, 4);
  try {
    context.registerCleanup?.(storage.close.bind(storage));
    const start = storage.allocate(0);
    let length = 0;
    for await (const chunk of normalizeXmlChunks(source)) {
      const bytes = new Uint8Array(chunk.length * 2), view = new DataView(bytes.buffer);
      for (let index = 0; index < chunk.length; index++) view.setUint16(index * 2, chunk.charCodeAt(index), true);
      await storage.append(bytes);
      length += chunk.length;
      // Match the buffered parser: an astral pair may extend a 512-unit window.
      const checkpoint = budget.tick(Math.min(chunk.length, 512)); if (checkpoint) await checkpoint;
    }
    const queued: XmlEvent[] = [];
    const frames = new StoredXmlFrames(storage);
    const parser = parseXmlSourceSteps(length, {
      ...budget.limits, maxContentNodes: budget.limits.maxNodes, expectedEncoding: "UTF-8", retainTree: false, storeFrames: true,
      recover, ...(consume ? { events: (event: XmlEvent) => { queued.push(event); } } : {}),
    });
    let step = parser.next();
    try {
      while (true) {
        for (const event of queued) await consume!(event);
        queued.length = 0;
        if (step.done) { await storage.close(); return step.value; }
        if (typeof step.value === "number") {
          const checkpoint = budget.tick(step.value); if (checkpoint) await checkpoint;
        } else if ("frameOperation" in step.value) {
          await frames.execute(step.value);
        } else {
          const request = step.value;
          const bytes = await storage.read(start + request.offset * 2, request.length * 2);
          const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
          const units = new Uint16Array(request.length);
          for (let index = 0; index < units.length; index++) units[index] = view.getUint16(index * 2, true);
          request.value = String.fromCharCode(...units);
        }
        step = parser.next();
      }
    } finally { if (!step.done) parser.return(undefined as never); }
  } catch (error) {
    try { await storage.close(); }
    catch { /* Preserve the parser, input or cancellation failure. */ }
    throw error;
  }
}
