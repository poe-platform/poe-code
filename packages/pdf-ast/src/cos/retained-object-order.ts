import { IntegerTable, PagedStorage } from "@poe-code/safe-fs/storage";
import { PdfError } from "../errors.js";
import { cosDict, dictGet } from "../ast.js";
import { readCosXrefRevision } from "./range-xref.js";
import { scanCosRangeObjects } from "./range-repair.js";
import type { PdfFileSource } from "../source.js";
import type { PdfIndexStorage } from "./object-index.js";
import type { PdfRetainedDocument } from "../retained-document.js";

/** Buffered parsing inserts physical objects before unpacking compressed ones.
 * Recover that observable object order with caller-backed identity membership. */
export async function* retainedObjectOrder(document: PdfRetainedDocument, source: PdfFileSource, storage: PdfIndexStorage, signal: AbortSignal): AsyncGenerator<number> {
  const backing = new PagedStorage({ fs: storage.fs, cwd: storage.directory, env: {}, signal }, 4);
  const seen = new IntegerTable(backing), streams = new IntegerTable(backing);
  let failed = false, work = 0;
  async function candidate(number: number) {
    signal.throwIfAborted(); if (++work % 64 === 0) await new Promise<void>(resolve => setTimeout(resolve, 0)); signal.throwIfAborted();
    if (await seen.get(BigInt(number)) !== undefined) return false;
    await seen.set(BigInt(number), 1n);
    const entry = await document.crossReference.index.get(number, signal);
    return entry !== undefined && entry.type !== "free";
  }
  try {
    if (document.crossReference.revisionCount) {
      for (const kind of ["uncompressed", "compressed"]) {
        const revisions = new IntegerTable(backing);
        let offset: number | undefined = document.crossReference.xrefOffset;
        while (offset !== undefined && await revisions.get(BigInt(offset)) === undefined) {
          await revisions.set(BigInt(offset), 1n);
          const revision = readCosXrefRevision(source, offset, { signal });
          try {
            let step = await revision.next();
            while (!step.done) {
              const number = step.value.objectNumber, entry = await document.crossReference.index.get(number, signal);
              if (entry?.type === kind && await candidate(number)) yield number;
              step = await revision.next();
            }
            const previous = dictGet(step.value, "Prev"); offset = previous?.kind === "number" ? previous.value : undefined;
          } finally { await revision.return(cosDict({})); }
        }
      }
    } else {
      for await (const event of scanCosRangeObjects(source, { signal })) if (event.kind === "object" && await candidate(event.object.objectNumber)) yield event.object.objectNumber;
      for await (const event of scanCosRangeObjects(source, { signal })) {
        if (event.kind !== "object") continue;
        const number = event.object.objectNumber;
        if (await streams.get(BigInt(number)) !== undefined) continue;
        await streams.set(BigInt(number), 1n);
        const entry = await document.crossReference.index.get(number, signal);
        if (entry?.type !== "uncompressed") continue;
        const object = await document.objects.get(number, entry.generationNumber ?? 0), type = object?.value.kind === "dict" ? dictGet(object.value, "Type") : undefined;
        if (!object?.stream || type?.kind !== "name" || type.decoded !== "ObjStm") continue;
        try { for await (const member of document.objects.objectStreamEntries(number, entry.generationNumber ?? 0)) if (await candidate(member.objectNumber)) yield member.objectNumber; }
        catch (error) { if (!(error instanceof PdfError) || error.code !== "E_PARSE") throw error; }
      }
    }
  } catch (error) { failed = true; throw error; }
  finally { await backing.close().catch(error => { if (!failed) throw error; }); }
}
