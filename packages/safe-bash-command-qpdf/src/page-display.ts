import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { PdfMutableObjectStore, cosDict, dictGet, type PdfCosDict, type PdfCosNode, type PdfIndexStorage, type PdfRetainedDocument } from "@poe-code/pdf-ast";

/** Match resource-order image listings, keeping traversal frames and membership
 * on caller storage even for broad or deeply nested form graphs. */
async function* imageParts(document: PdfRetainedDocument, page: PdfCosDict, storage: PdfIndexStorage, signal: AbortSignal): AsyncGenerator<string> {
  const values = new PdfMutableObjectStore(storage, { signal });
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const visited = new IntegerTable(backing, 64);
  let top = -1, failed = false, work = 0;
  async function pageResources() {
    const direct = await document.lookup(dictGet(page, "Resources"));
    if (direct?.value.kind === "dict") return { value: direct.value, inherited: false };
    const parents = new IntegerTable(backing, 64);
    let current: PdfCosDict | undefined = page;
    while (current) {
      signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const node = dictGet(current, "Resources");
      if (node) {
        const found = await document.lookup(node);
        return found?.value.kind === "dict" && !found.stream ? { value: found.value, inherited: true } : undefined;
      }
      const parent = dictGet(current, "Parent");
      if (parent?.kind === "ref") {
        if (await parents.get(BigInt(parent.objectNumber)) !== undefined) break;
        await parents.set(BigInt(parent.objectNumber), 1n);
      }
      const found = (await document.lookup(parent))?.value;
      current = found?.kind === "dict" ? found : undefined;
    }
    return undefined;
  }
  async function push(node: PdfCosNode | undefined, inherited = false) {
    const resource = await document.lookup(node);
    if (resource?.value.kind !== "dict" || resource.stream) return;
    const found = await document.lookup(dictGet(resource.value, "XObject"));
    if (found?.value.kind !== "dict" || (found.stream && !inherited)) return;
    // PdfPage materializes inherited resource subdictionaries using last-key
    // precedence and JavaScript's property order, including numeric names.
    const objects = inherited ? cosDict(Object.fromEntries(found.value.entries.map(entry => [entry.key.decoded, entry.value]))) : found.value;
    const ref = await values.allocate(objects), bytes = new Uint8Array(24), view = new DataView(bytes.buffer);
    view.setFloat64(0, top); view.setFloat64(8, ref.objectNumber);
    const next = backing.allocate(24); await backing.write(next, bytes); top = next;
  }
  try {
    const resources = await pageResources();
    if (resources) await push(resources.value, resources.inherited);
    while (top >= 0) {
      signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0));
      const bytes = await backing.read(top, 24), frame = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
      const objects = (await values.get(frame.getFloat64(8)))!.value;
      if (objects.kind !== "dict") throw new Error("Invalid retained image traversal frame");
      const index = frame.getFloat64(16), entry = objects.entries[index];
      if (!entry) { top = frame.getFloat64(0); continue; }
      frame.setFloat64(16, index + 1); await backing.write(top, bytes);
      const reference = entry.value.kind === "ref" ? entry.value : undefined;
      const value = (await document.lookup(entry.value))?.value;
      if (value?.kind !== "dict") continue;
      const subtype = dictGet(value, "Subtype");
      if (subtype?.kind !== "name") continue;
      if (subtype.decoded === "Image") {
        const width = dictGet(value, "Width"), height = dictGet(value, "Height");
        yield "    /"; yield entry.key.decoded;
        yield `: ${reference ? `${reference.objectNumber} ${reference.generationNumber} R` : "inline"} (${width?.kind === "number" ? width.value : 0} x ${height?.kind === "number" ? height.value : 0})\n`;
      } else if (subtype.decoded === "Form") {
        if (reference) {
          if (await visited.get(BigInt(reference.objectNumber)) !== undefined) continue;
          await visited.set(BigInt(reference.objectNumber), 1n);
        }
        await push(dictGet(value, "Resources"));
      }
    }
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([values.close(), backing.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}

export async function* pageDisplayParts(document: PdfRetainedDocument, storage: PdfIndexStorage, highest: number, withImages: boolean, signal: AbortSignal): AsyncGenerator<string> {
  let count = 0;
  for await (const page of document.pages()) {
    const ref = page.reference ?? { objectNumber: ++highest, generationNumber: 0 };
    yield `page ${++count}: ${ref.objectNumber} ${ref.generationNumber} R\n`;
    if (withImages) { yield "  images:\n"; yield* imageParts(document, page.dict, storage, signal); }
    yield "  content:\n";
    const contents = dictGet(page.dict, "Contents");
    for (const node of contents?.kind === "array" ? contents.items : contents ? [contents] : []) {
      if (node.kind === "ref") yield `    ${node.objectNumber} ${node.generationNumber} R\n`;
    }
  }
  if (!count) yield "\n";
}
