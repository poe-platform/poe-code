import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { PdfError, cosDict, dictGet, readCosXrefRevision, scanCosRangeObjects, type PdfCosDict, type PdfFileSource, type PdfIndexStorage, type PdfRetainedDocument } from "@poe-code/pdf-ast";

/** Recover the buffered reader's insertion order without retaining its Map:
 * revision order (uncompressed before compressed), or repaired file order. */
async function firstDictionary(document: PdfRetainedDocument, source: PdfFileSource, storage: PdfIndexStorage, signal: AbortSignal): Promise<PdfCosDict | undefined> {
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const seen = new IntegerTable(backing), revisions = new IntegerTable(backing), streams = new IntegerTable(backing);
  let failed = false;
  async function candidate(number: number) {
    if (await seen.get(BigInt(number)) !== undefined) return;
    await seen.set(BigInt(number), 1n);
    const entry = await document.crossReference.index.get(number, signal);
    if (!entry || entry.type === "free") return;
    const object = await document.objects.get(number, entry.generationNumber ?? 0);
    if (!object?.stream && object?.value.kind === "dict" && dictGet(object.value, "Linearized") !== undefined) return { dict: object.value, type: entry.type };
    return;
  }
  try {
    if (document.crossReference.revisionCount) {
      let offset: number | undefined = document.crossReference.xrefOffset, compressed: PdfCosDict | undefined;
      while (offset !== undefined && await revisions.get(BigInt(offset)) === undefined) {
        await revisions.set(BigInt(offset), 1n);
        const revision = readCosXrefRevision(source, offset, { signal });
        try {
          let step = await revision.next();
          while (!step.done) {
            const match = await candidate(step.value.objectNumber);
            if (match?.type === "uncompressed") return match.dict;
            if (match && !compressed) compressed = match.dict;
            step = await revision.next();
          }
          const previous = dictGet(step.value, "Prev"); offset = previous?.kind === "number" ? previous.value : undefined;
        } finally { await revision.return(cosDict({})); }
      }
      if (compressed) return compressed;
    } else {
      // Repairs retain the first insertion position, even when a later body
      // replaces its value. Compressed members follow all physical objects.
      for await (const event of scanCosRangeObjects(source, { signal })) if (event.kind === "object") {
        const match = await candidate(event.object.objectNumber); if (match) return match.dict;
      }
      for await (const event of scanCosRangeObjects(source, { signal })) {
        if (event.kind !== "object") continue;
        const number = event.object.objectNumber;
        if (await streams.get(BigInt(number)) !== undefined) continue;
        await streams.set(BigInt(number), 1n);
        const entry = await document.crossReference.index.get(number, signal);
        if (!entry || entry.type !== "uncompressed") continue;
        const object = await document.objects.get(number, entry.generationNumber ?? 0), type = object?.value.kind === "dict" ? dictGet(object.value, "Type") : undefined;
        if (!object?.stream || type?.kind !== "name" || type.decoded !== "ObjStm") continue;
        try {
          for await (const member of document.objects.objectStreamEntries(number, entry.generationNumber ?? 0)) {
            const match = await candidate(member.objectNumber); if (match) return match.dict;
          }
        } catch (error) { if (!(error instanceof PdfError) || error.code !== "E_PARSE") throw error; }
      }
    }
    // PdfDocument materializes inline pages after parsing the object graph.
    for await (const page of document.pages()) if (!page.reference && dictGet(page.dict, "Linearized") !== undefined) return page.dict;
    return undefined;
  } catch (error) { failed = true; throw error; }
  finally { await backing.close().catch(error => { if (!failed) return Promise.reject(error); }); }
}

export async function* linearizationParts(document: PdfRetainedDocument, source: PdfFileSource, storage: PdfIndexStorage,
  filename: string | undefined, pageCount: number, signal: AbortSignal): AsyncGenerator<string> {
  const dict = await firstDictionary(document, source, storage, signal);
  yield filename ?? "empty";
  if (!dict) { yield ": not linearized\n"; return; }
  async function number(key: string, fallback = 0) {
    const node = (await document.lookup(dictGet(dict!, key)))?.value; return node?.kind === "number" ? node.value : fallback;
  }
  const hints = (await document.lookup(dictGet(dict, "H")))?.value;
  async function hint(index: number) {
    const node = hints?.kind === "array" ? (await document.lookup(hints.items[index]))?.value : undefined;
    return node && "value" in node ? node.value ?? 0 : 0;
  }
  yield `: linearized\nLinearization dictionary: L=${await number("L")} H=[${await hint(0)} ${await hint(1)}] O=${await number("O")} E=${await number("E")} N=${await number("N", pageCount)} T=${await number("T")}\nno linearization errors\n`;
}
