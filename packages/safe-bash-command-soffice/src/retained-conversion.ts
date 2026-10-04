import { retainDocxText } from "./retained-docx-text.js";
import { retainSpreadsheetConversion } from "./retained-spreadsheet-conversion.js";
import { retainXlsxText } from "./retained-xlsx.js";
import { RetainedOfficeBlocks } from "./retained-office-blocks.js";
import { retainOdtText } from "./retained-odt.js";
import { convertOdsStream } from "./spreadsheet.js";
import { retainTextPdf } from "./retained-pdf.js";
import { RetainedPlainText } from "./retained-plain.js";
import { retainTextDocx, retainOfficeXml } from "./retained-docx.js";
import { resolvePath } from "@poe-code/safe-fs/core";
import { FsError, type FileStaging } from "@poe-code/safe-fs/contracts";
import { writeBytes, type ByteSink } from "safe-bash-contracts/io";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import type { CommandContext } from "safe-bash-contracts/command";
import { escapeHtmlText } from "./html.js";
import { RetainedRtfText } from "./retained-rtf.js";
import type { RetainedTextSnapshot } from "./retained-blocks.js";
import { withSofficeInputs, type RetainedSofficeContext, type SofficeSnapshot } from "./retained-input.js";
import type { SofficeLimits } from "./index.js";

type Context = RetainedSofficeContext & { readonly stdout: ByteSink; readonly stderr: ByteSink; readonly registerCleanup?: NonNullable<CommandContext["registerCleanup"]> };

/** Keep the legacy conversion order, including reads of earlier generated outputs. */
export async function tryRetainedTextConversion(args: { readonly inputs: readonly string[]; readonly outdir: string; readonly convertSpec: string | undefined },
  context: Context, limits: SofficeLimits, chargeOutput: (bytes: number) => void): Promise<{ exitCode: number } | undefined> {
  const { fs, cwd, signal } = context, { inputs, convertSpec, outdir } = args;
  if (!convertSpec || !inputs.length || (!fs.readStream && !fs.openReadFile) || !fs.prepareStagingResolution || !fs.createStagedFile || !fs.publishStagedFile || !fs.removeStagedFile) return undefined;
  const capabilities = fs.capabilities;
  if (!capabilities.atomicFileStaging || !capabilities.retainedStagingWrite || !capabilities.retainedStagingCleanup || !capabilities.atomicStagingAncestry || !capabilities.atomicStagedFileMutation || !capabilities.synchronousFollowedStagingResolution || !capabilities.guardedStagingPublication) return undefined;
  const colon = convertSpec.indexOf(":"), nextColon = colon < 0 ? -1 : convertSpec.indexOf(":", colon + 1);
  const format = (colon < 0 ? convertSpec : convertSpec.slice(0, colon)).toLowerCase();
  const explicitFilter = colon < 0 ? "" : convertSpec.slice(colon + 1, nextColon < 0 ? undefined : nextColon);
  const structured = [".pdf", ".docx", ".odt", ".ods", ".odp", ".xlsx", ".pptx", ".html", ".htm", ".csv"];
  const docxConversion = (input: string) => input.toLowerCase().endsWith(".docx") && format !== "pdf";
  const plainTableConversion = (input: string) => ![...structured, ".rtf"].some(extension => input.toLowerCase().endsWith(extension)) && ["csv", "xlsx"].includes(format);
  const openDocumentConversion = (input: string) => [".odt", ".ods", ".odp"].some(extension => input.toLowerCase().endsWith(extension)) &&
    !(input.toLowerCase().endsWith(".ods") && ["csv", "xlsx"].includes(format));
  const spreadsheetTextConversion = (input: string) => input.toLowerCase().endsWith(".xlsx") && !["pdf", "html", "docx", "xlsx", "csv"].includes(format);
  if (!inputs.every(input => docxConversion(input) || plainTableConversion(input) || openDocumentConversion(input) || [".xlsx", ".csv"].some(extension => input.toLowerCase().endsWith(extension)) ? true : input.toLowerCase().endsWith(".ods") && (format === "csv" || format === "xlsx") ? true :
    input.toLowerCase().endsWith(".rtf") ? true :
    !structured.some(extension => input.toLowerCase().endsWith(extension)) && !["xlsx", "csv"].includes(format))) return undefined;
  return withSofficeInputs(inputs, context, limits, async (storage, sources) => {
    const original = new Map(sources), pending = new Map<string, SofficeSnapshot>(), messages: string[] = [];
    const rtf = new RetainedRtfText(storage, signal), plain = new RetainedPlainText(storage, signal);
    const parsedRtf = new WeakMap<SofficeSnapshot, RetainedTextSnapshot>(), parsedPlain = new WeakMap<SofficeSnapshot, RetainedTextSnapshot>();
    const encoder = new TextEncoder();
    let stderr = "";
    for (const input of inputs) {
      signal.throwIfAborted();
      const source = sources.get(resolvePath(cwd, input));
      if (!source) { stderr = `Error: source file could not be loaded: ${input}\n`; break; }
      const basename = input.split("/").at(-1) ?? "document", dot = basename.lastIndexOf(".");
      const stem = dot >= 0 && dot < basename.length - 1 ? basename.slice(0, dot) : basename;
      const path = resolvePath(cwd, outdir, `${stem}.${format}`);
      let output = source;
      if (plainTableConversion(input) || input.toLowerCase().endsWith(".csv") || (input.toLowerCase().endsWith(".xlsx") && !spreadsheetTextConversion(input))) {
        try { output = await retainSpreadsheetConversion(storage, source, context, format, stem, nextColon < 0 ? undefined : convertSpec.slice(nextColon + 1), plainTableConversion(input) ? input.toLowerCase().endsWith(".md") ? "markdown" : "text" : input.toLowerCase().endsWith(".csv") ? "csv" : "xlsx"); }
        catch (error) {
          signal.throwIfAborted(); stderr = `Error: conversion failed: ${error instanceof Error ? error.message : String(error)}\n`;
          messages.length = 0; break;
        }
      } else if (docxConversion(input) || openDocumentConversion(input) || spreadsheetTextConversion(input)) {
        const document = format === "pdf" ? new RetainedOfficeBlocks(storage, signal) : undefined;
        let text: SofficeSnapshot;
        try { text = docxConversion(input) ? await retainDocxText(storage, source, context, "\n\n", format === "html" || format === "docx" ? { format, title: stem } : undefined) : spreadsheetTextConversion(input) ? await retainXlsxText(storage, source, context) : await retainOdtText(storage, source, context, document ? { blocks: document } : format === "docx" ? { docx: true } : format === "html" ? { htmlTitle: stem } : { paragraphSeparator: "\n\n" }); }
        catch (error) {
          signal.throwIfAborted();
          stderr = `Error: conversion failed: ${error instanceof Error ? error.message : String(error)}\n`;
          messages.length = 0; break;
        }
        if (format === "docx" || document) {
          const archive = document ? await retainTextPdf(storage, document, document.snapshot(), stem, context, nextColon < 0 ? undefined : convertSpec.slice(nextColon + 1)) : await retainOfficeXml(storage, (async function* () {
            for (let offset = 0; offset < text.size; offset += 16384) {
              signal.throwIfAborted();
              yield new Uint8Array(await storage.read(text.position + offset, Math.min(16384, text.size - offset)));
            }
          })(), signal);
          const position = storage.allocate(archive.size);
          let written = 0;
          for await (const bytes of archive.read()) {
            signal.throwIfAborted(); await storage.write(position + written, bytes); written += bytes.length;
          }
          output = { position, size: archive.size };
        } else if (format === "html") output = text;
        else {
          const position = storage.allocate(text.size + 1);
          for (let offset = 0; offset < text.size; offset += 16384) {
            signal.throwIfAborted();
            await storage.write(position + offset, new Uint8Array(await storage.read(text.position + offset, Math.min(16384, text.size - offset))));
          }
          await storage.write(position + text.size, Uint8Array.of(10));
          output = { position, size: text.size + 1 };
        }
      } else if (input.toLowerCase().endsWith(".ods") && (format === "csv" || format === "xlsx")) {
        const position = storage.allocate(0);
        let size = 0;
        try {
          await convertOdsStream({ kind: "range", filename: input, source: {
            size: source.size,
            async read(offset, maximum) {
              signal.throwIfAborted();
              return new Uint8Array(await storage.read(source.position + offset, Math.min(16384, maximum, source.size - offset)));
            }
          } }, { kind: "stream", sink: { async write(chunk) {
            for (let offset = 0; offset < chunk.length; offset += 16384) {
              signal.throwIfAborted();
              const part = chunk.subarray(offset, offset + 16384);
              await storage.append(part); size += part.length;
            }
          } } }, format, nextColon < 0 ? undefined : convertSpec.slice(nextColon + 1), signal, { fs, directory: cwd });
        } catch (error) {
          signal.throwIfAborted();
          stderr = `Error: conversion failed: ${error instanceof Error ? error.message : String(error)}\n`;
          // Earlier successful conversions remain publishable, as in the byte API.
          messages.length = 0;
          break;
        }
        output = { position, size };
      } else if (input.toLowerCase().endsWith(".rtf") || input.toLowerCase().endsWith(".md") || format === "html" || format === "docx" || format === "pdf") {
        const rich = input.toLowerCase().endsWith(".rtf"), text = rich ? rtf : plain, parsed = rich ? parsedRtf : parsedPlain;
        let retained = parsed.get(source);
        if (!retained) { retained = await text.retain(source.position, source.size); parsed.set(source, retained); }
        const snapshot = retained;
        async function* chunks() {
          if (format !== "html") { yield* text.stream(snapshot, "\n\n"); yield Uint8Array.of(10); return; }
          yield encoder.encode(`<!DOCTYPE html>\n<html><head><meta charset="utf-8"><title>${escapeHtmlText(stem)}</title></head><body>\n`);
          for (let block = 0; block < snapshot.count; block++) {
            const tag = await text.isHeading(snapshot, block) ? "h1" : "p", decoder = new TextDecoder("utf-8", { ignoreBOM: true });
            yield encoder.encode(`<${tag}>`);
            for await (const bytes of text.streamBlock(snapshot, block)) yield encoder.encode(escapeHtmlText(decoder.decode(bytes, { stream: true })));
            yield encoder.encode(escapeHtmlText(decoder.decode()) + `</${tag}>\n`);
          }
          yield encoder.encode("</body></html>\n");
        }
        // Metadata reads may allocate in the same backing store. Reserve the
        // complete encoded range first so publication and later inputs are contiguous.
        const archive = format === "docx" ? await retainTextDocx(storage, text, snapshot, signal) : format === "pdf" ? await retainTextPdf(storage, text, snapshot, stem, context, nextColon < 0 ? undefined : convertSpec.slice(nextColon + 1)) : undefined;
        const outputChunks = archive ? () => archive.read() : chunks;
        let size = archive?.size ?? 0;
        if (!archive) for await (const bytes of outputChunks()) {
          signal.throwIfAborted(); size += bytes.length;
          if (!Number.isSafeInteger(size)) throw new FsError("EFBIG");
        }
        const position = storage.allocate(size); let written = 0;
        for await (const bytes of outputChunks()) {
          if (bytes.length > size - written) throw new FsError("EIO", { message: "Text encoder exceeded its measured size" });
          for (let offset = 0; offset < bytes.length; offset += 16384) {
            signal.throwIfAborted(); await storage.write(position + written + offset, bytes.subarray(offset, offset + 16384));
          }
          written += bytes.length;
        }
        if (written !== size) throw new FsError("EIO", { message: "Text encoder returned fewer bytes than measured" });
        output = { position, size };
      }
      sources.set(path, output);
      if (original.get(path) === output) pending.delete(path); else pending.set(path, output);
      const filter = explicitFilter || (format === "csv" ? "Text - txt - csv (StarCalc)" : format === "pdf"
        ? [".xlsx", ".csv", ".ods"].some(extension => input.toLowerCase().endsWith(extension)) ? "calc_pdf_Export"
          : [".pptx", ".odp"].some(extension => input.toLowerCase().endsWith(extension)) ? "impress_pdf_Export" : "writer_pdf_Export"
        : `${format}_Export`);
      messages.push(`convert ${input} -> ${path} using filter : ${filter}\n`);
    }
    if (stderr) await writeBytes(context.stderr, encoder.encode(stderr), signal);
    for (const message of messages) chargeOutput(encoder.encode(message).length);
    for (const message of messages) await writeBytes(context.stdout, encoder.encode(message), signal);
    for (const [path, source] of pending) {
      chargeOutput(source.size);
      const directory = resolvePath(path, "..");
      try { await fs.mkdir(directory, { recursive: true, signal }); } catch { signal.throwIfAborted(); }
      const chunks = (async function* () {
        for (let offset = 0; offset < source.size; offset += 16384) {
          signal.throwIfAborted();
          yield new Uint8Array(await storage.read(source.position + offset, Math.min(16384, source.size - offset)));
        }
      })();
      await publish(context, path, chunks);
    }
    return { exitCode: stderr ? 1 : 0 };
  });
}

async function publish(context: Context, path: string, chunks: AsyncIterable<Uint8Array>): Promise<void> {
  const { fs, signal } = context;
  const capabilities = await fs.capabilitiesFor?.(path, { signal, stagingResolution: true, followFinalSymlink: true }) ?? fs.capabilities;
  if (!capabilities.atomicFileStaging || !capabilities.retainedStagingWrite || !capabilities.retainedStagingCleanup || !capabilities.atomicStagingAncestry || !capabilities.atomicStagedFileMutation || !capabilities.synchronousFollowedStagingResolution || !capabilities.guardedStagingPublication)
    throw new FsError("ENOTSUP", { path, message: "Text output requires retained atomic staging" });
  const resolution = await fs.prepareStagingResolution!(path, { signal, followFinalSymlink: true });
  if (resolution.destination && resolution.destination.type !== "file") throw new FsError("EISDIR", { path });
  let staging: FileStaging | undefined, failed = true;
  try {
    staging = await fs.createStagedFile!(`${resolvePath(resolution.path, "..")}/.soffice-${crypto.randomUUID()}`, "output", { type: "file", data: new Uint8Array() },
      { parent: resolution.parent, retainCleanup: true, mode: resolution.destination ? resolution.destination.mode & 0o7777 : 0o666, signal });
    if (!staging.writer || !staging.cleanup) throw new FsError("ENOTSUP", { path, message: "Text backend omitted retained staging handles" });
    for await (const bytes of chunks) await writeFileOutput(context, bytes, data => staging!.writer!.write(data, { signal }));
    const stat = await staging.writer.finish({ signal });
    signal.throwIfAborted();
    await fs.publishStagedFile!({ ...staging, file: { ...staging.file, stat } }, resolution.path,
      { parent: resolution.parent, destination: resolution.destination, ancestors: resolution.ancestors, commitGuard: resolution.validate, preserveIdentity: resolution.destination !== null, signal });
    failed = false;
  } finally {
    let failure: { error: unknown } | undefined;
    if (staging?.cleanup) {
      try { await staging.cleanup.remove(); } catch (error) { failure = { error }; }
      try { await staging.cleanup.close(); } catch (error) { failure ??= { error }; }
    } else if (staging) {
      try { await fs.removeStagedFile!(staging); } catch (error) { failure = { error }; }
    }
    if (!failed && failure) await Promise.reject(failure.error);
  }
}
