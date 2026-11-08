import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { PdfFileSource, PdfMutableObjectStore, PdfNameIndex, cosDict, cosString, decodePdfString, dictGet, type PdfCosNode, type PdfRetainedDocument } from "@poe-code/pdf-ast";

type Storage = ConstructorParameters<typeof PdfMutableObjectStore>[0];

/** Decode all attachments before publication, keeping payloads and duplicate
 * filename ordering on caller storage instead of a whole-document byte map. */
export async function* retainedUnpack(document: PdfRetainedDocument, storage: Storage, directory: string, inputNames: Iterable<string>, signal: AbortSignal, includeSentinel = false): AsyncGenerator<{ path: string; chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array> }> {
  const names = new PdfNameIndex(storage, Infinity, signal), outputs = new PdfMutableObjectStore(storage, { signal });
  const stack = new PdfMutableObjectStore(storage, { signal }), backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4), seen = new IntegerTable(backing, 64);
  const cleanDir = directory.endsWith("/") ? directory.slice(0, -1) : directory;
  let pending = 0, work = 0, failed = false;
  async function checkpoint() { signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
  async function resolve(node: PdfCosNode | undefined) { await checkpoint(); const found = await document.lookup(node); return found?.stream ? undefined : found?.value; }
  async function spec(raw: PdfCosNode | undefined, fallback = "attachment.bin") {
    const dict = await resolve(raw); if (dict?.kind !== "dict") return;
    const filename = await resolve(dictGet(dict, "UF") ?? dictGet(dict, "F"));
    const name = filename?.kind === "string" ? decodePdfString(filename) : fallback;
    const leaf = name.slice(Math.max(name.lastIndexOf("/"), name.lastIndexOf("\\")) + 1);
    if (!leaf || leaf === "." || leaf === ".." || leaf.includes("\0")) throw new Error("Invalid embedded attachment filename");
    const ef = await resolve(dictGet(dict, "EF")); if (ef?.kind !== "dict") return;
    const data = await document.lookup(dictGet(ef, "UF") ?? dictGet(ef, "F") ?? dictGet(ef, "DOS") ?? dictGet(ef, "Mac") ?? dictGet(ef, "Unix"));
    if (!data?.stream || !data.reference) return;
    const path = cleanDir && cleanDir !== "." ? `${cleanDir}/${leaf}` : leaf;
    const nameIndex = await names.intern(path);
    const staged = await PdfFileSource.fromStream(storage.fs, storage.directory, document.objects.decodeStream(data.reference.objectNumber, data.reference.generationNumber), { signal });
    let failed = false;
    try { await outputs.set({ objectNumber: nameIndex.index + 1, generationNumber: 0, value: cosDict({ Path: cosString(path) }), stream: { length: staged.size, chunks: staged.stream(0, staged.size, signal) } }); }
    catch (error) { failed = true; throw error; }
    finally { await staged.close().catch(error => { if (!failed) throw error; }); }
  }
  const push = async (value: PdfCosNode) => { await checkpoint(); await stack.set({ objectNumber: ++pending, generationNumber: 0, value }); };
  async function associated(raw: PdfCosNode | undefined) { const array = await resolve(raw); if (array?.kind === "array") for (const item of array.items) await spec(item); }
  try {
    // A legacy Map keeps overwritten input keys ahead of newly extracted files.
    for (const name of inputNames) await names.intern(name);
    const root = await resolve(document.crossReference.rootRef);
    if (root?.kind === "dict") {
      const dictionary = await resolve(dictGet(root, "Names")), tree = dictionary?.kind === "dict" ? dictGet(dictionary, "EmbeddedFiles") : undefined;
      if (tree) await push(tree);
      while (pending) {
        await checkpoint(); const raw = (await stack.get(pending--))!.value;
        if (raw.kind === "ref") { if (await seen.get(BigInt(raw.objectNumber))) continue; await seen.set(BigInt(raw.objectNumber), 1n); }
        const branch = await resolve(raw); if (branch?.kind !== "dict") continue;
        const pairs = await resolve(dictGet(branch, "Names"));
        if (pairs?.kind === "array") for (let i = 0; i + 1 < pairs.items.length; i += 2) { const name = await resolve(pairs.items[i]); await spec(pairs.items[i + 1], name?.kind === "string" ? decodePdfString(name) : "attachment.bin"); }
        const kids = await resolve(dictGet(branch, "Kids"));
        if (kids?.kind === "array") for (let i = kids.items.length - 1; i >= 0; i--) await push(kids.items[i]!);
      }
      await associated(dictGet(root, "AF"));
    }
    for await (const page of document.pages()) {
      await associated(dictGet(page.dict, "AF"));
      const annotations = await resolve(dictGet(page.dict, "Annots"));
      if (annotations?.kind === "array") for (const raw of annotations.items) {
        const annotation = await resolve(raw); if (annotation?.kind !== "dict") continue;
        const type = await resolve(dictGet(annotation, "Subtype"));
        if (type?.kind === "name" && type.decoded === "FileAttachment") await spec(dictGet(annotation, "FS"));
      }
    }
    for await (const output of outputs.objects()) {
      const path = output.value.kind === "dict" ? dictGet(output.value, "Path") : undefined;
      if (path?.kind === "string" && output.stream) {
        const name = decodePdfString(path);
        if (includeSentinel || name !== "-") yield { path: name, chunks: output.stream.chunks };
      }
    }
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([names.close(), outputs.close(), stack.close(), backing.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
