import { PdfError, PdfFileSource, PdfRetainedDocument, PdfStagedOutputs, PdfStagingStorage, renderRetainedPagePixels, getDisplayListCropBox,
  encodeRetainedPng, encodeRetainedTiff, encodeJpegChunks, encodePortableBitmapChunks, type PdfOutputEntry } from "@poe-code/pdf-ast";
import type { CommandContext } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { readBytes, writeBytes, type ByteSink } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { yieldTurn } from "safe-bash-contracts/yield";
import type { PdftoppmPlan } from "./parse.js";

export async function executeRetainedRaster(context: CommandContext, plan: PdftoppmPlan, stdout: ByteSink, signal: AbortSignal, maximum: number): Promise<{ exitCode: number }> {
  const encoder = new TextEncoder(), directory = resolvePath(context.cwd, context.env.TMPDIR || "/tmp");
  const storage = new PdfStagingStorage({ fs: context.fs, directory });
  const diagnostic = async (message: string, exitCode: number) => { if (!plan.quiet) await writeBytes(context.stderr, encoder.encode(message), signal); return { exitCode }; };
  let source: PdfFileSource | undefined, document: PdfRetainedDocument | undefined, outputs: PdfStagedOutputs | undefined, failed = false;
  try {
    await context.fs.mkdir(directory, { recursive: true, signal });
    const maxInputBytes = Math.min(maximum, context.inputBudget?.maxBytes ?? Infinity);
    try {
      if (plan.inputPath === "-") {
        async function* input() { let total = 0; for await (const bytes of readBytes(context.stdin, signal)) { total += bytes.length; context.inputBudget?.check(total); yield bytes; } }
        source = await PdfFileSource.fromStream(storage.fs, directory, input(), { maxInputBytes, signal });
      } else {
        const path = resolvePath(context.cwd, plan.inputPath); context.inputBudget?.check((await context.fs.stat(path, { signal })).size);
        source = await PdfFileSource.open(context.fs, path, { maxInputBytes, signal }); context.inputBudget?.check(source.size);
      }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && "code" in error && error.code === "ENOENT") return await diagnostic(`I/O Error: Couldn't open file '${plan.inputPath}'\n`, 1);
      throw error;
    }
    if (!source.size) return await diagnostic("Syntax Error: Document stream is empty\n", 1);
    let count = 0;
    try {
      document = await PdfRetainedDocument.open(source, storage, { recovery: "repair", signal, ...(plan.password ? { password: plan.password } : {}) });
      for await (const ignored of document.pages()) { void ignored; count++; await yieldTurn(signal); }
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof PdfError) || error.code === "E_LIMIT" || error.code === "E_CANCELLED") throw error;
      return await diagnostic(`PDF Error: ${error.message}\n`, 1);
    }
    const totalPages = Math.max(1, count), endPage = plan.lastPage > 0 ? Math.min(totalPages, plan.lastPage) : totalPages;
    if (plan.firstPage > totalPages || plan.firstPage > endPage) return await diagnostic(`Command Line Error: Wrong page range given: the first page (${plan.firstPage}) can not be after the last page (${endPage}).\n`, 99);
    const prefix = plan.positionals[1], toStdout = !prefix || prefix === "-", retained = document;
    const selected = (number: number) => number >= plan.firstPage && number <= endPage && !(plan.oddOnly && number % 2 === 0) && !(plan.evenOnly && number % 2 === 1);
    function name(number: number) {
      if (toStdout) return String(number);
      const effective = plan.setPageNo !== undefined ? plan.setPageNo + number - plan.firstPage : number;
      return plan.singleFile && !plan.forceNum ? `${prefix}.${plan.format}` : `${prefix}${plan.sep}${String(effective).padStart(Math.max(String(totalPages).length, String(effective).length), "0")}.${plan.format}`;
    }
    async function* entries(): AsyncGenerator<PdfOutputEntry> {
      for await (const page of retained.pages()) {
        signal.throwIfAborted(); const number = page.index + 1; if (number > endPage) break; if (!selected(number)) continue;
        const attributes = await page.attributes(), media = attributes.mediaBox;
        const width = Math.abs(media[2] - media[0]), height = Math.abs(media[3] - media[1]), ox = Math.min(media[0], media[2]), oy = Math.min(media[1], media[3]);
        const box = plan.useCropBox ? getDisplayListCropBox({ width, height, cropBox: [attributes.cropBox[0] - ox, attributes.cropBox[1] - oy, attributes.cropBox[2] - ox, attributes.cropBox[3] - oy] }) : [0, 0, width, height];
        const quarter = attributes.rotation === 90 || attributes.rotation === 270, ptW = quarter ? box[3]! - box[1]! : box[2]! - box[0]!, ptH = quarter ? box[2]! - box[0]! : box[3]! - box[1]!;
        let dpiX = plan.dpiX ?? plan.dpi, dpiY = plan.dpiY ?? plan.dpi;
        if (plan.scaleTo > 0) dpiX = dpiY = plan.scaleTo * 72 / Math.max(ptW, ptH, 1);
        else {
          if (plan.scaleToX > 0) { dpiX = plan.scaleToX * 72 / Math.max(ptW, 1); if (plan.scaleToY < 0) dpiY = dpiX; }
          if (plan.scaleToY > 0) { dpiY = plan.scaleToY * 72 / Math.max(ptH, 1); if (plan.scaleToX < 0) dpiX = dpiY; }
        }
        const bitmap = await renderRetainedPagePixels(page, storage, { dpiX, dpiY, useCropBox: plan.useCropBox, hideAnnotations: plan.hideAnnotations, transparent: plan.transparent,
          antialiasText: plan.antialiasText, antialiasVector: plan.antialiasVector, thinLineMode: plan.thinLineMode, tileSize: 256, signal,
          ...(plan.hasCrop ? { cropRect: { x: plan.cropX, y: plan.cropY, width: plan.cropW, height: plan.cropH } } : {}) });
        async function* pixels() {
          for await (const bytes of bitmap.pixels) {
            if (plan.colorMode !== "rgb" && (plan.format === "png" || plan.format === "tif" || plan.format === "jpg")) {
              for (let at = 0; at < bytes.length; at += 4) {
                const luminance = Math.round(0.299 * bytes[at]! + 0.587 * bytes[at + 1]! + 0.114 * bytes[at + 2]!);
                const value = plan.colorMode === "mono" ? (luminance < 128 ? 0 : 255) : luminance;
                bytes[at] = value; bytes[at + 1] = value; bytes[at + 2] = value;
              }
            }
            yield bytes;
          }
        }
        const chunks = plan.format === "png" ? encodeRetainedPng(bitmap.width, bitmap.height, pixels(), storage, { signal })
          : plan.format === "tif" ? encodeRetainedTiff(bitmap.width, bitmap.height, pixels(), storage, { dpi: dpiX, compression: plan.tiffCompression, signal })
          : plan.format === "jpg" ? encodeJpegChunks(bitmap.width, bitmap.height, pixels(), { quality: plan.jpegQuality, signal })
          : encodePortableBitmapChunks(plan.format === "pgm" || plan.format === "pbm" ? plan.format : "ppm", bitmap.width, bitmap.height, pixels(), { signal });
        yield { name: name(number), chunks }; if (plan.singleFile) break;
      }
    }
    outputs = await PdfStagedOutputs.create(storage, entries(), { signal });
    if (plan.progress && !plan.quiet) for (let number = plan.firstPage; number <= endPage; number++) {
      if (!selected(number)) continue;
      await writeBytes(context.stderr, encoder.encode(`${number} ${endPage} ${toStdout ? "-" : name(number)}\n`), signal); if (plan.singleFile) break;
    }
    for await (const entry of outputs.entries()) {
      if (toStdout) for await (const bytes of entry.contents()) await writeBytes(stdout, bytes, signal);
      else try { await publish(context, resolvePath(context.cwd, entry.name), entry.contents(), signal); }
      catch (error) { signal.throwIfAborted(); if (!(error instanceof Error) || !("code" in error)) throw error; await writeBytes(context.stderr, encoder.encode(`Could not write image to ${entry.name}; exiting\n`), signal); return { exitCode: 1 }; }
    }
    return { exitCode: 0 };
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([outputs?.close(), document?.close(), source?.close()]); if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
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

