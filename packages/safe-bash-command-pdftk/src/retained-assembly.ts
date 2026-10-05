import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { PdfMutableObjectStore, PdfNameIndex, PdfFileSource, createRetainedPageCopy, editRetainedDocument, cosArray, cosDict, cosNumber, cosString, decodePdfString, dictGet, dictSet, type PdfRetainedDocument, type RetainedBookmark, type RetainedPageRotation } from "@poe-code/pdf-ast";
import { iteratePdftkRangeToken, type ExpandedPageSelection } from "./index.js";
import { retainedUnpack } from "./retained-unpack.js";
import type { PdftkArguments } from "./arguments.js";

type Input = PdftkArguments["inputs"][number];
type Storage = ConstructorParameters<typeof PdfMutableObjectStore>[0];

/** Copy selections one at a time, retaining only one active source graph. */
export async function assembleRetainedPdftk(primary: PdfRetainedDocument, storage: Storage, options: PdftkArguments, counts: ReadonlyMap<Input, number>, handles: ReadonlyMap<string, Input>, open: (input: Input) => Promise<PdfRetainedDocument>, signal: AbortSignal): Promise<{ document: PdfRetainedDocument; close(): Promise<void> }> {
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const sourceBookmarks = new PdfMutableObjectStore(storage, { signal }), outputBookmarks = new PdfMutableObjectStore(storage, { signal }), rotations = new PdfMutableObjectStore(storage, { signal }), attachments = new PdfMutableObjectStore(storage, { signal });
  const names = new PdfNameIndex(storage, Infinity, signal);
  const states = new Map<Input, { bookmarks: IntegerTable; resources: IntegerTable }>();
  const used = new Set<Input>(), rangeHandles = new Map([...handles].map(([handle, input]) => [handle, { pageCount: counts.get(input)! }]));
  let current: PdfRetainedDocument | undefined, currentInput: Input | undefined, copy: Awaited<ReturnType<typeof createRetainedPageCopy>> | undefined, edited: Awaited<ReturnType<typeof editRetainedDocument>> | undefined;
  let work = 0, attachmentCount = 0, failed = false;
  async function checkpoint() { signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted(); }
  async function document(input: Input) {
    if (currentInput !== input) { await current?.close(); current = undefined; currentInput = undefined; current = await open(input); currentInput = input; }
    return current!;
  }
  function* selections(): Generator<ExpandedPageSelection> {
    if (!options.opArgs.length) {
      for (const input of options.inputs) for (let pageNumber = 1; pageNumber <= counts.get(input)!; pageNumber++) yield { handle: input.handle, pageNumber };
    } else if (options.operation === "shuffle") {
      const iterators = options.opArgs.map(arg => iteratePdftkRangeToken(arg, rangeHandles, options.inputs[0]!.handle));
      try { let pending = true; while (pending) { pending = false; for (const iterator of iterators) { const next = iterator.next(); if (!next.done) { pending = true; yield next.value; } } } }
      finally { for (const iterator of iterators) iterator.return(undefined); }
    } else for (const arg of options.opArgs) yield* iteratePdftkRangeToken(arg, rangeHandles, options.inputs[0]!.handle);
  }
  async function state(input: Input, source: PdfRetainedDocument) {
    let result = states.get(input); if (result) return result;
    result = { bookmarks: new IntegerTable(backing, 64), resources: new IntegerTable(backing, 64) }; states.set(input, result);
    for await (const bookmark of source.outlineDetails()) {
      await checkpoint();
      const key = BigInt(bookmark.pageIndex) * 2n, previous = await result.bookmarks.get(key + 1n);
      const ref = await sourceBookmarks.allocate(cosDict({ Title: cosString(bookmark.title), Level: cosNumber(bookmark.level), Next: cosNumber(0) }));
      if (previous) {
        const row = (await sourceBookmarks.get(Number(previous)))!;
        if (row.value.kind === "dict") { dictSet(row.value, "Next", cosNumber(ref.objectNumber)); await sourceBookmarks.set(row); }
      } else await result.bookmarks.set(key, BigInt(ref.objectNumber));
      await result.bookmarks.set(key + 1n, BigInt(ref.objectNumber));
    }
    return result;
  }
  async function* sources() {
    let ordinal = 0, pageIndex = 0;
    for (const selection of selections()) {
      await checkpoint(); ordinal++;
      const input = handles.get(selection.handle) ?? options.inputs[0]!, source = await document(input), record = await state(input, source);
      used.add(input);
      yield { document: source, indices: [selection.pageNumber - 1], resourceState: { has: async (index: number) => Boolean(await record.resources.get(BigInt(index))), add: async (index: number) => { await record.resources.set(BigInt(index), 1n); } } };
      if (selection.rotation) await rotations.allocate(cosArray([cosNumber(pageIndex), cosNumber(selection.rotation.degrees), cosNumber(selection.rotation.kind === "relative" ? 1 : 0)]));
      pageIndex++;
      let item = Number(await record.bookmarks.get(BigInt(selection.pageNumber - 1) * 2n) ?? 0n);
      while (item) {
        await checkpoint(); const row = (await sourceBookmarks.get(item))!.value;
        if (row.kind !== "dict") throw new Error("Invalid bookmark record");
        await outputBookmarks.allocate(cosArray([dictGet(row, "Title")!, dictGet(row, "Level")!, cosNumber(ordinal)]));
        const next = dictGet(row, "Next"); item = next?.kind === "number" ? next.value : 0;
      }
    }
  }
  async function* bookmarkEdits(): AsyncGenerator<RetainedBookmark> {
    for await (const object of outputBookmarks.objects()) {
      await checkpoint(); const value = object.value;
      if (value.kind !== "array" || value.items[0]?.kind !== "string" || value.items[1]?.kind !== "number" || value.items[2]?.kind !== "number") throw new Error("Invalid output bookmark");
      yield { title: decodePdfString(value.items[0]), level: value.items[1].value, pageNumber: value.items[2].value };
    }
  }
  async function* rotationEdits(): AsyncGenerator<RetainedPageRotation> {
    for await (const object of rotations.objects()) {
      await checkpoint(); const value = object.value;
      if (value.kind !== "array" || value.items[0]?.kind !== "number" || value.items[1]?.kind !== "number" || value.items[2]?.kind !== "number") throw new Error("Invalid output rotation");
      yield { pageIndex: value.items[0].value, degrees: value.items[1].value, relative: value.items[2].value === 1 };
    }
  }
  async function* attachmentEdits() {
    for await (const object of attachments.objects()) {
      await checkpoint(); const name = object.value.kind === "dict" ? dictGet(object.value, "Filename") : undefined, filename = name?.kind === "string" ? decodePdfString(name) : "";
      if (object.stream) yield { filename, chunks: (async function* () { yield* object.stream!.chunks; })() };
    }
  }
  try {
    copy = await createRetainedPageCopy(sources(), storage, { signal, metadataSource: key => primary.streamInfoValue(key) });
    for (const input of used) {
      await checkpoint(); const source = await document(input);
      for await (const file of retainedUnpack(source, storage, ".", [], signal, true)) {
        const name = await names.intern(file.path); if (name.added) attachmentCount++;
        // The extractor supplies decoded chunks; size them on caller storage
        // before replacing a prior file with the same leaf name.
        const payload = await PdfFileSource.fromStream(storage.fs, storage.directory, file.chunks, { signal });
        let failed = false;
        try { await attachments.set({ objectNumber: name.index + 1, generationNumber: 0, value: cosDict({ Filename: cosString(file.path) }), stream: { length: payload.size, chunks: payload.stream(0, payload.size, signal) } }); }
        catch (error) { failed = true; throw error; }
        finally { await payload.close().catch(error => { if (!failed) throw error; }); }
      }
    }
    edited = await editRetainedDocument(await copy.openDocument(), storage, { signal, rotations: rotationEdits(), bookmarks: bookmarkEdits(), ...(attachmentCount ? { appendAttachments: attachmentEdits() } : {}) });
    const result = edited, pages = copy;
    return { document: result.document, async close() { const results = await Promise.allSettled([result.close(), pages.close()]); for (const outcome of results) if (outcome.status === "rejected") throw outcome.reason; } };
  } catch (error) { failed = true; await Promise.allSettled([edited?.close(), copy?.close()]); throw error; }
  finally {
    const results = await Promise.allSettled([current?.close(), sourceBookmarks.close(), outputBookmarks.close(), rotations.close(), attachments.close(), names.close(), backing.close()]);
    if (!failed) for (const outcome of results) if (outcome.status === "rejected") { await Promise.allSettled([edited?.close(), copy?.close()]); await Promise.reject(outcome.reason); }
  }
}
