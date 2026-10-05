import { PdfFileSource, PdfRetainedDocument, PdfRetainedDecodedImage, PdfStagingStorage, PdfStagedOutputs, PdfError,
  encodeRetainedPng, encodeJpegChunks, streamHtmlPageText, type PdfOutputEntry } from "@poe-code/pdf-ast";
import type { CommandContext } from "safe-bash-contracts/command";
import { InputByteBudget, readBytes, writeBytes, type ByteSink } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { yieldTurn } from "safe-bash-contracts/yield";
import { applyPopplerOutputEncoding } from "./output-encoding.js";
import { publishPdfOutput } from "./retained-output.js";
import type { HtmlPlan } from "./html-arguments.js";

const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
async function* base64(input: AsyncIterable<Uint8Array>, signal: AbortSignal) {
  let value = 0, count = 0, text = "";
  for await (const bytes of input) {
    signal.throwIfAborted();
    for (const byte of bytes) {
      value = (value << 8) | byte;
      if (++count !== 3) continue;
      text += alphabet[(value >>> 18) & 63]! + alphabet[(value >>> 12) & 63]! + alphabet[(value >>> 6) & 63]! + alphabet[value & 63]!;
      count = 0; value = 0;
      if (text.length >= 4096) { yield text; text = ""; }
    }
  }
  if (count) {
    value <<= (3 - count) * 8;
    text += alphabet[(value >>> 18) & 63]! + alphabet[(value >>> 12) & 63]! + (count === 2 ? alphabet[(value >>> 6) & 63]! : "=") + "=";
  }
  if (text) yield text;
}

export async function executeRetainedHtml(context: CommandContext, plan: HtmlPlan, stdout: ByteSink, signal: AbortSignal, maxInputBytes = Infinity): Promise<{ exitCode: number }> {
  const encoder = new TextEncoder(), directory = resolvePath(context.cwd, context.env.TMPDIR || "/tmp");
  const budget = new InputByteBudget(maxInputBytes, context.inputBudget);
  const maximum = Math.min(maxInputBytes, context.inputBudget?.maxBytes ?? Infinity);
  const storage = new PdfStagingStorage({ fs: context.fs, directory });
  let source: PdfFileSource | undefined, document: PdfRetainedDocument | undefined, outputs: PdfStagedOutputs | undefined, failed = false;
  const error = async (message: string, exitCode: number) => { await writeBytes(context.stderr, encoder.encode(message), signal); return { exitCode }; };
  try {
    await context.fs.mkdir(directory, { recursive: true, signal });
    try {
      if (plan.inputPath === "-") {
        async function* input() {
          for await (const bytes of readBytes(context.stdin, signal)) { budget.charge(bytes.length); yield bytes; }
        }
        source = await PdfFileSource.fromStream(storage.fs, directory, input(), { signal, maxInputBytes: maximum });
        if (!source.size) return await error("I/O Error: Couldn't open file '-'\n", 1);
      } else {
        const path = resolvePath(context.cwd, plan.inputPath);
        const size = (await context.fs.stat(path, { signal })).size; budget.charge(size);
        source = await PdfFileSource.open(context.fs, path, { signal, maxInputBytes: maximum });
        if (source.size > size) budget.charge(source.size - size);
      }
    } catch (failure) {
      signal.throwIfAborted(); budget.assertOpen();
      if (failure instanceof PdfError && failure.code === "E_LIMIT") throw failure;
      return await error(`I/O Error: Couldn't open file '${plan.inputPath}'\n`, 1);
    }
    let pageCount = 0;
    try {
      document = await PdfRetainedDocument.open(source, storage, { signal, recovery: "repair", ...(plan.password ? { password: plan.password } : {}) });
      for await (const ignored of document.pages()) { void ignored; pageCount++; }
    } catch (failure) { signal.throwIfAborted(); return await error(`PDF Error: ${(failure as Error).message}\n`, 1); }
    const totalPages = Math.max(1, pageCount), endPage = plan.lastPage > 0 ? Math.min(totalPages, plan.lastPage) : totalPages;
    if (plan.firstPage > totalPages || (plan.lastPage > 0 && plan.firstPage > endPage)) {
      return await error(`Command Line Error: Wrong page range given: the first page (${plan.firstPage}) can not be after the last page (${endPage}).\n`, 99);
    }
    if (!pageCount) throw new PdfError("E_CAPABILITY", "Page index out of bounds: 0");
    const doc = document;
    async function* images(firstPage: number, lastPage: number) {
      let pageNumber = 0, number = 0;
      for await (const occurrence of doc.images({ firstPage, lastPage })) {
        await yieldTurn(signal);
        if (pageNumber !== occurrence.pageNumber) { pageNumber = occurrence.pageNumber; number = 0; }
        const name = `page${pageNumber}_${++number}.${plan.imageFmt}`;
        const decoded = await PdfRetainedDecodedImage.open(doc, occurrence, storage, { signal }); let imageFailed = false;
        try {
          const chunks = () => plan.imageFmt === "jpg" ? encodeJpegChunks(decoded.width, decoded.height, decoded.rows(), { signal })
            : encodeRetainedPng(decoded.width, decoded.height, decoded.rows(), storage, { signal });
          yield { name, width: decoded.width, height: decoded.height, chunks };
        } catch (failure) { imageFailed = true; throw failure; }
        finally { await decoded.close().catch(failure => { if (!imageFailed) throw failure; }); }
      }
    }
    async function* imageMarkup(page: number) {
      if (plan.ignoreImages) return;
      for await (const image of images(page, page)) {
        if (plan.xmlMode) yield `    <image top="0" left="0" width="${image.width}" height="${image.height}" src="`;
        else yield '  <img src="';
        if (plan.dataUrls) {
          yield `data:image/${plan.imageFmt === "jpg" ? "jpeg" : "png"};base64,`;
          yield* base64(image.chunks(), signal);
        } else {
          // External images were encoded during staging. Stdout still validates
          // their codecs, preserving failures even though it has no image files.
          if (plan.stdoutOutput) for await (const ignored of image.chunks()) void ignored;
          yield image.name;
        }
        yield plan.xmlMode ? '"/>\n' : `" width="${image.width}" height="${image.height}"/>\n`;
      }
    }
    async function* indent(level: number) {
      for (let left = level * 2; left > 0; left -= 2048) { signal.throwIfAborted(); yield " ".repeat(Math.min(left, 2048)); }
    }
    async function* outlines() {
      let depth = 0, skipLevel: number | undefined;
      for await (const item of doc.streamOutlineDetails({ includeUntitled: true, includeNameTitles: false })) {
        if (skipLevel !== undefined) { if (item.level > skipLevel) continue; skipLevel = undefined; }
        let hasTitle = false; for await (const part of item.title()) if (part) { hasTitle = true; break; }
        if (!hasTitle) { skipLevel = item.level; continue; }
        await yieldTurn(signal);
        if (!depth) yield plan.xmlMode ? "  <outline>\n" : '<hr/>\n<a name="outline"></a><h1>Document Outline</h1>\n<ul>\n';
        const level = Math.max(1, item.level);
        if (depth) {
          if (level > depth) { for (let at = depth; at < level; at++) { if (plan.xmlMode) yield* indent(at + 1); yield plan.xmlMode ? "<outline>\n" : "<ul>\n"; } }
          else {
            if (!plan.xmlMode) yield "</li>\n";
            for (let at = depth; at > level; at--) { if (plan.xmlMode) yield* indent(at); yield plan.xmlMode ? "</outline>\n" : "</ul>\n</li>\n"; }
          }
        }
        depth = level;
        if (plan.xmlMode) yield* indent(depth + 1);
        yield plan.xmlMode ? `<item page="${item.pageIndex + 1}">` : `<li><a href="#page${item.pageIndex + 1}">`;
        for await (const part of item.title()) yield escape(part);
        yield plan.xmlMode ? "</item>\n" : "</a>\n";
      }
      if (depth && !plan.xmlMode) yield "</li>\n";
      for (let at = depth; at > 0; at--) { if (plan.xmlMode) yield* indent(at); yield plan.xmlMode ? "</outline>\n" : at > 1 ? "</ul>\n</li>\n" : "</ul>\n"; }
    }
    async function* markup() {
      if (plan.xmlMode) yield '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE pdf2xml SYSTEM "pdf2xml.dtd">\n<pdf2xml producer="@poe-code/pdf-ast" version="24.08.0">\n';
      else {
        yield '<!DOCTYPE html>\n<html>\n<head><meta charset="utf-8"/><title>';
        let hasTitle = false;
        for await (const part of doc.streamInfoValue("Title")) { hasTitle = true; yield escape(part); }
        if (!hasTitle) for (let at = 0; at < plan.inputPath.length; at += 2048) yield escape(plan.inputPath.slice(at, at + 2048));
        yield "</title></head>\n<body>\n";
      }
      for await (const page of doc.pages()) {
        await yieldTurn(signal);
        const number = page.index + 1;
        if (number < plan.firstPage) continue; if (number > endPage) break;
        const { mediaBox } = await page.attributes(), width = Math.abs(mediaBox[2] - mediaBox[0]), height = Math.abs(mediaBox[3] - mediaBox[1]);
        yield plan.xmlMode ? `  <page number="${number}" position="absolute" top="0" left="0" height="${Math.round(height * plan.zoom)}" width="${Math.round(width * plan.zoom)}">\n`
          : `<div class="page" id="page${number}" style="position:relative;width:${Math.round(width * plan.zoom)}pt;height:${Math.round(height * plan.zoom)}pt;">\n`;
        const index = await page.indexText(storage, { mode: "layout", retainFontNames: true, signal }); let pageFailed = false;
        try { yield* streamHtmlPageText(doc, page, index, storage, { xml: plan.xmlMode, zoom: plan.zoom, height, signal, images: () => imageMarkup(number) }); }
        catch (failure) { pageFailed = true; throw failure; }
        finally { await index.close().catch(failure => { if (!pageFailed) throw failure; }); }
        yield plan.xmlMode ? "  </page>\n" : "</div>\n";
      }
      yield* outlines(); yield plan.xmlMode ? "</pdf2xml>\n" : "</body>\n</html>\n";
    }
    async function* encoded() {
      let high = "";
      for await (const part of markup()) {
        let text = high + part; high = "";
        const last = text.charCodeAt(text.length - 1);
        if (last >= 0xd800 && last <= 0xdbff) { high = text.slice(-1); text = text.slice(0, -1); }
        if (text) yield encoder.encode(applyPopplerOutputEncoding(text, plan.encoding));
      }
      if (high) yield encoder.encode(applyPopplerOutputEncoding(high, plan.encoding));
    }
    let inputReplaced = plan.outPath === plan.inputPath;
    async function* entries(): AsyncGenerator<PdfOutputEntry> {
      // Reserve the input's original map position without retaining its bytes.
      // If an output replaces it, last-payload selection preserves publication order.
      if (!plan.stdoutOutput) yield { name: plan.inputPath, chunks: [] };
      if (!plan.ignoreImages && !plan.dataUrls && !plan.stdoutOutput) {
        for await (const image of images(plan.firstPage, endPage)) {
          const name = plan.imageDirectory + image.name;
          if (name === plan.inputPath) inputReplaced = true;
          yield { name, chunks: image.chunks() };
        }
      }
      yield { name: plan.outPath, chunks: encoded() };
    }
    outputs = await PdfStagedOutputs.create(storage, entries(), { signal });
    for await (const output of outputs.entries()) {
      if (!plan.stdoutOutput && output.name === plan.inputPath && !inputReplaced) continue;
      if (plan.stdoutOutput) for await (const bytes of output.contents()) await writeBytes(stdout, bytes, signal);
      else try { await publishPdfOutput(context, resolvePath(context.cwd, output.name), output.contents(), signal); }
      catch (failure) {
        signal.throwIfAborted(); if (!(failure instanceof Error) || !("code" in failure)) throw failure;
        return await error(`I/O Error: Couldn't open html file '${output.name}'\n`, 0);
      }
    }
    return { exitCode: 0 };
  } catch (failure) { failed = true; throw failure; }
  finally {
    const closed = await Promise.allSettled([outputs?.close(), document?.close(), source?.close()]);
    if (!failed) for (const result of closed) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}
