import { linearizationAssignments } from "./linearization-assignments.js";
import { checkLinearization } from "./linearization-check.js";
import { linearizationReport } from "./linearization-report.js";
import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { PdfError, cosDict, dictGet, readCosXrefRevision, readPdfHeader, scanCosRangeObjects, type PdfCosDict, PdfFileSource, type PdfIndexStorage, type PdfRetainedDocument } from "@poe-code/pdf-ast";

/** Recover the buffered reader's insertion order without retaining its Map:
 * revision order (uncompressed before compressed), or repaired file order. */
async function firstDictionary(document: PdfRetainedDocument, source: PdfFileSource, storage: PdfIndexStorage, signal: AbortSignal, headerOffset: number): Promise<PdfCosDict | undefined> {
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
          const previous = dictGet(step.value, "Prev"); offset = previous?.kind === "number" ? previous.value + headerOffset : undefined;
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
  filename: string | undefined, pageCount: number, signal: AbortSignal, mode: "show" | "check" | "both" | "inspect", warnings: string[]): AsyncGenerator<string> {
  const { offset: headerOffset } = await readPdfHeader(source, signal);
  const dict = await firstDictionary(document, source, storage, signal, headerOffset);
  if (!dict) { if (mode === "inspect") return; yield `${filename ?? "empty"} is not linearized\n`.repeat(mode === "both" ? 2 : 1); return; }
  async function number(key: string, fallback = 0) {
    const node = (await document.lookup(dictGet(dict!, key)))?.value; return node?.kind === "number" ? node.value : fallback;
  }
  const hints = (await document.lookup(dictGet(dict, "H")))?.value;
  async function hint(index: number) {
    const node = hints?.kind === "array" ? (await document.lookup(hints.items[index]))?.value : undefined;
    return node?.kind === "number" ? node.value : 0;
  }
  const values = { file_size: await number("L"), first_page_object: await number("O"), first_page_end: await number("E"), npages: pageCount, xref_zero_offset: await number("T"), first_page: await number("P"), H_offset: await hint(0), H_length: await hint(1) };
  let decoded: PdfFileSource | undefined, sharedOffset = 0, outlineOffset: number | undefined;
  try {
    for await (const entry of document.crossReference.index.entries(signal)) {
      if (entry.type !== "uncompressed" || entry.offset !== values.H_offset + headerOffset) continue;
      const object = await document.objects.get(entry.objectNumber, entry.generationNumber ?? 0);
      if (!object?.stream || object.value.kind !== "dict") break;
      const shared = (await document.lookup(dictGet(object.value, "S")))?.value, outline = (await document.lookup(dictGet(object.value, "O")))?.value;
      sharedOffset = shared?.kind === "number" ? shared.value : 0; outlineOffset = outline?.kind === "number" ? outline.value : undefined;
      decoded = await PdfFileSource.fromStream(storage.fs, storage.directory, document.objects.decodeStream(entry.objectNumber, entry.generationNumber ?? 0), { signal });
      break;
    }
    let mainXref = document.crossReference.xrefOffset - headerOffset;
    const prev = dictGet(document.crossReference.trailer, "Prev");
    if (prev?.kind === "number") mainXref = prev.value;
    const validation = checkLinearization(values, source.size - headerOffset, await number("N"), decoded?.size ?? 0, sharedOffset, mainXref, outlineOffset);
    let validationStep = validation.next();
    const pages = document.pages();
    try {
      while (!validationStep.done) {
        signal.throwIfAborted();
        const request = validationStep.value;
        let bytes: Uint8Array = new Uint8Array();
        if (!("kind" in request)) bytes = await decoded!.read(request.offset, request.length, signal);
        else if (request.kind === "file") bytes = await source.read(request.offset + headerOffset, request.length, signal);
        else if (request.kind === "layout") {
          const root = dictGet(document.crossReference.trailer, "Root");
          if (root?.kind === "ref") {
            const assignments = linearizationAssignments(root, document.crossReference.trailer, false);
            let step = assignments.next();
            while (!step.done) {
              signal.throwIfAborted();
              if (typeof step.value === "string") { step = assignments.next(undefined); continue; }
              const ref = step.value, object = await document.objects.get(ref.objectNumber, ref.generationNumber);
              const entry = await document.crossReference.index.get(ref.objectNumber, signal);
              step = assignments.next(object ? { value: object.value, container: entry?.objectStreamNumber } : undefined);
            }
            if (step.value) request.layout = step.value;
          }
        } else {
          const number = request.kind === "page" ? (await pages.next()).value?.reference?.objectNumber : request.number;
          const entry = number === undefined ? undefined : await document.crossReference.index.get(number, signal);
          const object = entry?.type === "uncompressed" ? await document.objects.get(number!, entry.generationNumber ?? 0) : undefined;
          if (object) { request.objectNumber = object.objectNumber; request.start = object.span.start - headerOffset; request.end = object.span.end - headerOffset; }
        }
        validationStep = validation.next(bytes);
      }
    } finally { await pages.return(undefined); }
    if (validationStep.value.length) warnings.push(...validationStep.value);
    else if (mode === "check" || mode === "both") yield `${filename ?? "empty"}: no linearization errors\n`;
    if (mode === "check" || mode === "inspect") return;
    const report = linearizationReport(filename ?? "empty", values, decoded?.size ?? 0, sharedOffset, outlineOffset);
    let step = report.next();
    while (!step.done) {
      signal.throwIfAborted();
      if (typeof step.value === "string") { yield step.value; step = report.next(new Uint8Array()); }
      else step = report.next(await decoded!.read(step.value.offset, step.value.length, signal));
    }
    const root = dictGet(document.crossReference.trailer, "Root");
    if (decoded && root?.kind === "ref") {
      const assignments = linearizationAssignments(root, document.crossReference.trailer);
      let assignment = assignments.next();
      while (!assignment.done) {
        signal.throwIfAborted();
        if (typeof assignment.value === "string") { yield assignment.value; assignment = assignments.next(undefined); }
        else {
          const ref = assignment.value, object = await document.objects.get(ref.objectNumber, ref.generationNumber);
          const entry = await document.crossReference.index.get(ref.objectNumber, signal);
          assignment = assignments.next(object ? { value: object.value, container: entry?.objectStreamNumber } : undefined);
        }
      }
    }
  } finally { await decoded?.close(); }
}
