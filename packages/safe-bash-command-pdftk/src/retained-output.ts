import { retainedRotations } from "./retained-rotate.js";
import { editRetainedDocument, type RetainedAppendAttachment, PdfFileSource, PdfMutableObjectStore, PdfRetainedDocument, cosBool, dictDelete, dictGet, dictSet, encryptRetainedPdfChunks, retainedCosObjects, saveRetainedDocumentChunks, type PdfCosArray } from "@poe-code/pdf-ast";
import type { PdftkArguments } from "./arguments.js";

type Storage = ConstructorParameters<typeof PdfMutableObjectStore>[0];

/** Common PDF output flags; the caller retains input identities and publishes
 * the resulting chunks. Graph edits and encoded payloads use caller storage. */
export async function* retainedOutput(source: PdfRetainedDocument, storage: Storage, options: PdftkArguments, selectedId: PdfCosArray | undefined, signal: AbortSignal, handles: ReadonlyMap<string, { readonly pageCount: number }>, pageCount: number | undefined, attachments: AsyncIterable<RetainedAppendAttachment>, attachmentPage: string | undefined): AsyncGenerator<Uint8Array> {
  const store = new PdfMutableObjectStore(storage, { signal });
  let edited: Awaited<ReturnType<typeof editRetainedDocument>> | undefined;
  let document: PdfRetainedDocument | undefined, plaintext: PdfFileSource | undefined, failed = false;
  try {
    if (options.operation === "attach_files") {
      const pageIndex = attachmentPage !== undefined && pageCount! > 0 ? attachmentPage.toLowerCase() === "end" ? pageCount! - 1 : Math.max(0, Math.min(pageCount! - 1, (Number.parseInt(attachmentPage, 10) || 1) - 1)) : undefined;
      edited = await editRetainedDocument(source, storage, { signal, appendAttachments: attachments, ...(pageIndex !== undefined ? { attachmentPageIndex: pageIndex } : {}) });
    }
    const input = edited?.document ?? source;
    const pageReferences = edited ? { pageReferences: async function* () { for await (const page of input.pages()) if (page.reference) yield page.reference; } } : {};
    for await (const object of retainedCosObjects(input, storage, { signal })) await store.set(object);
    const reference = source.crossReference;
    const idArray = options.keepFinalId || options.keepFirstId ? selectedId ?? reference.idArray : reference.idArray ?? selectedId;
    document = await PdfRetainedDocument.openStore(store, storage, { rootRef: reference.rootRef, version: reference.version, ...pageReferences, ...(reference.infoRef ? { infoRef: reference.infoRef } : {}), ...(idArray ? { idArray } : {}), signal });
    const root = await document.lookup(reference.rootRef);
    if (root?.value.kind === "dict" && !root.stream && root.reference) {
      const form = await document.lookup(dictGet(root.value, "AcroForm"));
      if (form?.value.kind === "dict" && !form.stream) {
        if (options.dropXfa) dictDelete(form.value, "XFA");
        if (options.needAppearances) dictSet(form.value, "NeedAppearances", cosBool(true));
        if (form.reference) await store.set({ objectNumber: form.reference.objectNumber, generationNumber: form.reference.generationNumber, value: form.value });
        else dictSet(root.value, "AcroForm", form.value);
      }
      await store.set({ objectNumber: root.reference.objectNumber, generationNumber: root.reference.generationNumber, value: root.value });
    }
    const chunks = saveRetainedDocumentChunks(document, storage, { signal, ...(options.operation === "rotate" ? { rotations: retainedRotations(options.opArgs, handles, options.inputs[0]!.handle, pageCount!, storage, signal) } : {}), removeMetadata: options.dropXmp, streamMode: options.uncompressStreams ? "uncompress" : options.compressStreams ? "compress" : "preserve" });
    if (!options.userPassword && !options.ownerPassword) { yield* chunks; return; }
    plaintext = await PdfFileSource.fromStream(storage.fs, storage.directory, chunks, { signal });
    const allow = options.allowPermissions, all = allow.has("allfeatures");
    yield* encryptRetainedPdfChunks(plaintext, storage, { userPassword: options.userPassword ?? "", ownerPassword: options.ownerPassword ?? options.userPassword ?? "owner", revision: 6, signal,
      ...(allow.size ? { permissions: { print: all || allow.has("printing") || allow.has("degradedprinting"), modify: all || allow.has("modifycontents"), copy: all || allow.has("copycontents"), addNotes: all || allow.has("modifyannotations"), fillForms: all || allow.has("fillin") || allow.has("modifyannotations"), extractAccessibility: all || allow.has("screenreaders"), assemble: all || allow.has("assembly") || allow.has("modifycontents"), printHighRes: all || allow.has("printing") } } : {}) });
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([document?.close(), plaintext?.close(), store.close(), edited?.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
