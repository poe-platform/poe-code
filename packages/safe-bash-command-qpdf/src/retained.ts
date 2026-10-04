import { splitPageOutputs } from "./split.js";
import { iterateQpdfPageRange } from "./page-range.js";
import { linearizationParts } from "./linearization.js";
import { attachmentChunks, QpdfMissingAttachment } from "./attachments.js";
import { copyQpdfSelections, QpdfMissingInput } from "./selection.js";
import { xrefDisplayParts } from "./xref-display.js";
import { pageDisplayParts } from "./page-display.js";
import { displayNodeParts, encodeDisplayParts } from "./display.js";
import { editRetainedDocument, PdfError, PdfFileSource, PdfRetainedDocument, PdfStagedOutputs, saveRetainedDocumentChunks, retainedCosObjects, serializeRetainedCosDocumentChunks, cosArray, cosDict, cosName, cosNumber, cosRef, cosString, dictGet, type PdfCosNode } from "@poe-code/pdf-ast";
import type { CommandContext } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { writeBytes } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import type { QpdfLimits } from "./index.js";

export interface RetainedQpdfOptions {
  inputFile: string | undefined;
  emptyInput: boolean;
  splitPagesGroup: number | undefined;
  rotateSpecs: readonly { range: string; angle: number; relative: boolean; sign: number }[];
  listAttachments: boolean;
  showLinearization: boolean;
  showAttachmentKey: string | undefined;
  collateCount: number | undefined;
  pageSpecs: readonly { file: string; password?: string; range: string }[];
  outputFile: string | undefined;
  password: string | undefined;
  replaceInput: boolean;
  decrypt: boolean;
  removeInfo: boolean;
  removeMetadata: boolean;
  removeStructure: boolean;
  removeAcroform: boolean;
  removePageLabels: boolean;
  warningExit0: boolean;
  check: boolean;
  showNpages: boolean;
  showPages: boolean;
  showXref: boolean;
  withImages: boolean;
  showEncryption: boolean;
  isEncrypted: boolean;
  requiresPassword: boolean;
  showObject: { objNum: number; genNum: number } | undefined;
  rawStreamData: boolean;
  filteredStreamData: boolean;
}
export async function executeRetainedQpdf(context: CommandContext, options: RetainedQpdfOptions, limits: QpdfLimits, signal: AbortSignal, inputBytes = 0): Promise<{ exitCode: number }> {
  const diagnostic = async (message: string) => { await writeBytes(context.stderr, new TextEncoder().encode(message), signal); return { exitCode: 2 }; };
  const inputName = options.inputFile;
  const useEmpty = options.emptyInput && !options.isEncrypted && !options.requiresPassword;
  const storage = { fs: context.fs, directory: resolvePath(context.cwd, context.env.TMPDIR || "/tmp") };
  const inputs = new Map<string, PdfFileSource | undefined>();
  let source: PdfFileSource | undefined, document: PdfRetainedDocument | undefined, intermediate: PdfFileSource | undefined, output: PdfFileSource | undefined, failed = false;
  let splitOutputs: PdfStagedOutputs | undefined;
  let editedGraph: Awaited<ReturnType<typeof editRetainedDocument>> | undefined;
  async function publishInspection(chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>): Promise<void> {
    async function* admitted() {
      let total = 0;
      for await (const bytes of chunks) {
        if (bytes.length > limits.maxOutputBytes - total) throw new RangeError("Output byte limit exceeded");
        total += bytes.length; yield bytes;
      }
    }
    output = await PdfFileSource.fromStream(context.fs, storage.directory, admitted(), { signal, maxInputBytes: limits.maxOutputBytes });
    for await (const bytes of output.stream(0, output.size, signal)) await writeBytes(context.stdout, bytes, signal);
  }
  try {
    await context.fs.mkdir(storage.directory, { recursive: true, signal });
    const maximum = Math.min(limits.maxInputBytes, context.inputBudget?.maxBytes ?? Infinity);
    // Acquire identities and admit sizes without reading every input payload.
    for (const candidate of new Set([inputName, ...options.pageSpecs.map(spec => spec.file)])) {
      signal.throwIfAborted(); if (!candidate || candidate === "." || candidate === "-") continue;
      let acquired: PdfFileSource;
      try { acquired = await PdfFileSource.open(context.fs, resolvePath(context.cwd, candidate), { signal, maxInputBytes: maximum - inputBytes }); }
      catch (error) {
        signal.throwIfAborted();
        if ((error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "EISDIR"].includes(String(error.code))) ||
            (error instanceof PdfError && error.message === "PDF source must be a regular file")) { inputs.set(candidate, undefined); continue; }
        throw error;
      }
      inputs.set(candidate, acquired); inputBytes += acquired.size; context.inputBudget?.check(inputBytes);
    }
    if (inputName === "-" || options.pageSpecs.some(spec => spec.file === "-")) {
      const acquired = await PdfFileSource.fromStream(context.fs, storage.directory, context.stdin, { signal, maxInputBytes: maximum - inputBytes });
      inputs.set("-", acquired); inputBytes += acquired.size; context.inputBudget?.check(inputBytes);
    }
    if (useEmpty) {
      const objects = [cosDict({ Type: cosName("Catalog"), Pages: cosRef(2) }), cosDict({ Type: cosName("Pages"), Count: cosNumber(0), Kids: cosArray([]) }), cosDict({ Producer: cosString("@poe-code/pdf-ast") })];
      source = await PdfFileSource.fromStream(context.fs, storage.directory, serializeRetainedCosDocumentChunks({
        objects: objects.map((value, index) => ({ objectNumber: index + 1, generationNumber: 0, value })), rootRef: cosRef(1), infoRef: cosRef(3), signal,
      }, storage), { signal });
    } else {
      if (!inputName) return await diagnostic("qpdf: an input file is required\n");
      source = inputs.get(inputName);
      if (!source) return await diagnostic(`qpdf: cannot open ${inputName}\n`);
    }
    if (options.isEncrypted || options.requiresPassword) {
      // Preserve the compatibility predicate's literal marker test, including
      // malformed inputs, without decoding or retaining the complete payload.
      const marker = new TextEncoder().encode("/Encrypt");
      let matched = 0, encrypted = false;
      for await (const bytes of source.stream(0, source.size, signal)) {
        for (const byte of bytes) {
          matched = byte === marker[matched] ? matched + 1 : byte === marker[0] ? 1 : 0;
          if (matched === marker.length) { encrypted = true; break; }
        }
        if (encrypted) break;
      }
      if (options.isEncrypted || !encrypted) return { exitCode: encrypted ? 0 : 2 };
      if (options.password === undefined) return { exitCode: 0 };
      try {
        document = await PdfRetainedDocument.open(source, storage, { signal, recovery: "strict", password: options.password });
        for await (const object of retainedCosObjects(document, storage, { signal })) {
          if (object.stream) for await (const ignored of object.stream.chunks) void ignored;
        }
        return { exitCode: 3 };
      } catch (error) {
        signal.throwIfAborted();
        if (error instanceof PdfError && error.code !== "E_LIMIT") return { exitCode: 0 };
        throw error;
      }
    }
    try {
      document = await PdfRetainedDocument.open(source, storage, { signal, recovery: "repair", ...(options.password === undefined ? {} : { password: options.password }) });
    } catch (error) {
      signal.throwIfAborted(); if (!(error instanceof PdfError) || error.code === "E_LIMIT" || (error.code === "E_CAPABILITY" && error.message !== "Invalid PDF password")) throw error;
      return await diagnostic(`qpdf: ${inputName}: ${error.message}\n`);
    }
    if (options.showLinearization || options.check || options.showNpages || options.showEncryption || options.showObject || options.showPages || options.showXref || options.listAttachments || options.showAttachmentKey !== undefined) {
      let count = 0, linearized = false, highest = 0, inlineCount = 0;
      let inlinePage: PdfCosNode | undefined, selectedValue: PdfCosNode | undefined, selectedLength: number | undefined;
      try {
        for await (const object of retainedCosObjects(document, storage, { signal })) {
          highest = Math.max(highest, object.objectNumber);
          if (object.objectNumber === options.showObject?.objNum) { selectedValue = object.value; selectedLength = object.stream?.length; }
          if (!object.stream && object.value.kind === "dict" && dictGet(object.value, "Linearized") !== undefined) linearized = true;
          // Loading a buffered document authenticates every encrypted stream.
          if (object.stream) for await (const ignored of object.stream.chunks) void ignored;
        }
        for await (const page of document.pages()) {
          count++;
          if (!page.reference && highest + ++inlineCount === options.showObject?.objNum) inlinePage = page.dict;
        }
      } catch (error) {
        signal.throwIfAborted(); if (!(error instanceof PdfError) || error.code === "E_LIMIT" || (error.code === "E_CAPABILITY" && error.message !== "Invalid PDF password")) throw error;
        return await diagnostic(`qpdf: ${inputName}: ${error.message}\n`);
      }
      if (options.showLinearization) {
        const parts = linearizationParts(document, source, storage, inputName, count, signal);
        await publishInspection((async function* () { for await (const part of parts) yield* encodeDisplayParts([part], signal); })());
        return { exitCode: 0 };
      }
      if (!options.check && (options.showPages || ((options.showObject || options.showXref) && !options.showNpages && !options.showEncryption))) {
        const number = options.showObject?.objNum ?? NaN, entry = Number.isSafeInteger(number) && number >= 0 ? await document.crossReference.index.get(number, signal) : undefined, generation = entry?.generationNumber ?? 0;
        let chunks: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
        if (options.showPages) {
          const parts = pageDisplayParts(document, storage, highest, options.withImages, signal);
          chunks = (async function* () { for await (const part of parts) yield* encodeDisplayParts([part], signal); })();
        } else if (options.showXref) {
          const parts = xrefDisplayParts(document, source, storage, highest, signal);
          chunks = (async function* () { for await (const part of parts) yield* encodeDisplayParts([part], signal); })();
        } else if (selectedLength !== undefined && (options.rawStreamData || options.filteredStreamData)) chunks = document.objects.decodeStream(number, generation, { raw: !options.filteredStreamData });
        else {
          function* parts() { yield* displayNodeParts(selectedValue ?? inlinePage); if (selectedLength !== undefined) yield `\nstream\n...(${selectedLength} bytes)...\nendstream`; yield "\n"; }
          chunks = encodeDisplayParts(parts(), signal);
        }
        await publishInspection(chunks);
        return { exitCode: 0 };
      }
      if (!options.check && !options.showNpages && !options.showEncryption && (options.listAttachments || options.showAttachmentKey !== undefined)) {
        const chunks = attachmentChunks(document, storage, options.showAttachmentKey, signal);
        await publishInspection(chunks);
        return { exitCode: 0 };
      }
      const encryption = document.encryption;
      const message = options.check
        ? `checking ${inputName ?? "empty"}\nPDF Version: ${document.crossReference.version}\nFile is ${encryption ? "encrypted" : "not encrypted"}\nFile is ${count === 0 ? "empty" : linearized ? "linearized" : "not linearized"}\nNo syntax or stream encoding errors found; the file may still contain\nerrors that qpdf cannot detect\n`
        : options.showNpages ? `${count}\n`
        : encryption ? `R = ${encryption.revision}\nV = ${encryption.version}\nLength = ${encryption.keyLengthBits}\nprint: ${encryption.permissions.print ? "allowed" : "not allowed"}\nmodify: ${encryption.permissions.modify ? "allowed" : "not allowed"}\nextract for accessibility: ${encryption.permissions.copy ? "allowed" : "not allowed"}\n`
        : "File is not encrypted\n";
      const bytes = new TextEncoder().encode(message);
      if (bytes.length > limits.maxOutputBytes) throw new RangeError("Output byte limit exceeded");
      await writeBytes(context.stdout, bytes, signal);
      return { exitCode: 0 };
    }
    if (options.pageSpecs.length) {
      const selected = copyQpdfSelections(document, source, inputs, storage, options, signal);
      try { intermediate = await PdfFileSource.fromStream(context.fs, storage.directory, selected, { signal }); }
      finally { await selected.return(undefined); }
      document = await PdfRetainedDocument.open(intermediate, storage, { signal, recovery: "repair" });
    }
    const destination = options.replaceInput ? inputName : options.outputFile;
    if (!destination) return await diagnostic("qpdf: an output file is required\n");
    if (!options.replaceInput && inputName !== "-" && destination === inputName) return await diagnostic("qpdf: output file may not be the same as the input file (use --replace-input)\n");
    const { removeInfo, removeMetadata, removeStructure, removeAcroform, removePageLabels } = options;
    async function* rotations() {
      if (!options.rotateSpecs.length) return;
      let count = 0; for await (const ignored of document!.pages()) { void ignored; count++; }
      for (const edit of options.rotateSpecs) for (const number of iterateQpdfPageRange(edit.range, count)) {
        yield { pageIndex: number - 1, degrees: edit.angle * (edit.relative ? edit.sign : 1), relative: edit.relative };
      }
    }
    if (options.splitPagesGroup !== undefined) {
      if (removeInfo || removeMetadata || removeStructure || removeAcroform || removePageLabels) {
        editedGraph = await editRetainedDocument(document, storage, { removeInfo, removeMetadata, removeStructure, removeAcroform, removePageLabels, rotations: rotations(), signal });
      } else for await (const object of retainedCosObjects(document, storage, { signal })) {
        if (object.stream) for await (const ignored of object.stream.chunks) void ignored;
      }
      const parts = splitPageOutputs(editedGraph?.document ?? document, storage, destination, options.splitPagesGroup, editedGraph ? [] : options.rotateSpecs, signal);
      async function* entries() {
        // Preserve original Map insertion order when a split filename replaces
        // an input. Empty seed entries are discarded after staging.
        for (const [name, input] of inputs) if (input) yield { name, chunks: [] };
        let total = 0;
        for await (const part of parts) {
          async function* admitted() {
            for await (const bytes of part.chunks) {
              if (bytes.length > limits.maxOutputBytes - total) throw new RangeError("Output byte limit exceeded");
              total += bytes.length; yield bytes;
            }
          }
          yield { name: part.name, chunks: admitted() };
        }
      }
      splitOutputs = await PdfStagedOutputs.create(storage, entries(), { signal, maxNameChars: Infinity });
      for await (const entry of splitOutputs.entries()) {
        if (!entry.size) continue;
        try { const path = resolvePath(context.cwd, entry.name); await context.fs.mkdir(resolvePath(path, ".."), { recursive: true, signal }); await publish(context, path, entry.contents(), signal); }
        catch (error) {
          signal.throwIfAborted(); if (!(error instanceof Error) || !("code" in error)) throw error;
          return await diagnostic(`qpdf: open ${entry.name}: ${error.code === "ENOENT" ? "No such file or directory" : error.code}\n`);
        }
      }
      return { exitCode: 0 };
    }
    const producer = saveRetainedDocumentChunks(document, storage, { removeInfo, removeMetadata, removeStructure, removeAcroform, removePageLabels, signal, maxOutputBytes: limits.maxOutputBytes, rotations: rotations(), ...(options.decrypt && document.encryption ? { version: "1.7", omitId: true } : {}) });
    try { output = await PdfFileSource.fromStream(context.fs, storage.directory, producer, { signal, maxInputBytes: limits.maxOutputBytes }); }
    finally { await producer.return(undefined); }
    if (destination === "-") { for await (const bytes of output.stream(0, output.size, signal)) await writeBytes(context.stdout, bytes, signal); }
    else {
      try { const path = resolvePath(context.cwd, destination); await context.fs.mkdir(resolvePath(path, ".."), { recursive: true, signal }); await publish(context, path, output.stream(0, output.size, signal), signal); }
      catch (error) {
        signal.throwIfAborted(); if (!(error instanceof Error) || !("code" in error)) throw error;
        return await diagnostic(`qpdf: open ${destination}: ${error.code === "ENOENT" ? "No such file or directory" : error.code}\n`);
      }
    }
    return { exitCode: 0 };
  } catch (error) { failed = true; if (error instanceof QpdfMissingInput || error instanceof QpdfMissingAttachment) return await diagnostic(error.message); throw error; }
  finally {
    const results = await Promise.allSettled([splitOutputs?.close(), editedGraph?.close(), document?.close(), ...[...new Set([...inputs.values(), source, intermediate, output])].map(input => input?.close())]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}

async function publish(context: CommandContext, path: string, chunks: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<void> {
  const fs = context.fs;
  const capabilities = await fs.capabilitiesFor?.(path, { signal, create: true, stagingAncestry: true }) ?? fs.capabilities;
  if (!capabilities.atomicFileStaging || !capabilities.retainedStagingWrite || !capabilities.retainedStagingCleanup || !capabilities.atomicStagingAncestry ||
      !fs.prepareStagingResolution || !fs.createStagedFile || !fs.publishStagedFile) {
    throw new FsError("ENOTSUP", { path, message: "PDF output requires retained atomic staging" });
  }
  const resolution = await fs.prepareStagingResolution(path, { signal });
  const directory = resolvePath(resolution.path, "..");
  const staging = await fs.createStagedFile(`${directory}/.pdf-${crypto.randomUUID()}`, "output", { type: "file", data: new Uint8Array() },
    { parent: resolution.parent, retainCleanup: true, signal });
  let failed = false;
  try {
    if (!staging.writer || !staging.cleanup) throw new FsError("ENOTSUP", { path, message: "PDF backend omitted retained staging handles" });
    for await (const bytes of chunks) await writeFileOutput({ ...context, signal }, bytes, data => staging.writer!.write(data, { signal }));
    const stat = await staging.writer.finish({ signal });
    await fs.publishStagedFile({ ...staging, file: { ...staging.file, stat } }, resolution.path,
      { parent: resolution.parent, destination: resolution.destination, ancestors: resolution.ancestors, commitGuard: resolution.validate, signal });
  } catch (failure) { failed = true; throw failure; } finally {
    const cleanup = async () => { try { await staging.cleanup?.remove(); } finally { await staging.cleanup?.close(); } };
    await cleanup().catch(failure => { if (!failed) throw failure; });
  }
}

