import { streamRawBboxPage, type RawTextGeometry } from "./retained-bbox.js";
import { streamTextHtml, streamTextHtmlStart } from "./text-markup.js";
import { PdfError, PdfNameIndex, PdfFileSource, PdfRetainedDocument, PdfStagingStorage, dictGet, type PdfRetainedPage, type PdfCosDict } from "@poe-code/pdf-ast";
import type { CommandContext } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { readBytes, writeBytes, type ByteSink } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { yieldTurn } from "safe-bash-contracts/yield";
import { encodePopplerChunks } from "./output-encoding.js";

interface RawTextPlan {
  readonly raw: boolean;
  readonly removeHyphens: boolean;
  readonly layout: boolean;
  readonly colspacing?: number;
  readonly inputFile?: string;
  readonly outputFile?: string;
  readonly opw?: string;
  readonly upw?: string;
  readonly firstPage: number;
  readonly lastPage: number;
  readonly lastPageExplicit: boolean;
  readonly quiet: boolean;
  readonly htmlmeta: boolean;
  readonly tsv: boolean;
  readonly bbox: boolean;
  readonly bboxLayout: boolean;
  readonly urls: boolean;
  readonly invalidEolWarning: boolean;
  readonly nopgbrk: boolean;
  readonly nodiag: boolean;
  readonly clip: boolean;
  readonly cropbox: boolean;
  readonly cropX?: number;
  readonly cropY?: number;
  readonly cropW?: number;
  readonly cropH?: number;
  readonly resolution: number;
  readonly encoding: string;
  readonly eol: "unix" | "dos" | "mac";
}

async function publish(context: CommandContext, path: string, source: PdfFileSource, signal: AbortSignal) {
  const fs = context.fs;
  const capabilities = await fs.capabilitiesFor?.(path, { signal, create: true, stagingAncestry: true }) ?? fs.capabilities;
  if (!capabilities.atomicFileStaging || !capabilities.retainedStagingWrite || !capabilities.retainedStagingCleanup || !capabilities.atomicStagingAncestry
    || !fs.prepareStagingResolution || !fs.createStagedFile || !fs.publishStagedFile) {
    throw new FsError("ENOTSUP", { path, message: "PDF text output requires retained atomic staging" });
  }
  const resolution = await fs.prepareStagingResolution(path, { signal });
  const directory = resolvePath(resolution.path, "..");
  const staging = await fs.createStagedFile(`${directory}/.pdf-text-${crypto.randomUUID()}`, "output", { type: "file", data: new Uint8Array() },
    { parent: resolution.parent, retainCleanup: true, signal });
  let failed = false;
  try {
    if (!staging.writer || !staging.cleanup) throw new FsError("ENOTSUP", { path, message: "PDF backend omitted retained staging handles" });
    for await (const bytes of source.stream(0, source.size, signal)) {
      await writeFileOutput({ ...context, signal }, bytes, data => staging.writer!.write(data, { signal }));
    }
    const stat = await staging.writer.finish({ signal });
    await fs.publishStagedFile({ ...staging, file: { ...staging.file, stat } }, resolution.path,
      { parent: resolution.parent, destination: resolution.destination, ancestors: resolution.ancestors, commitGuard: resolution.validate, signal });
  } catch (error) { failed = true; throw error; }
  finally {
    const cleanup = async () => { try { await staging.cleanup?.remove(); } finally { await staging.cleanup?.close(); } };
    await cleanup().catch(error => { if (!failed) throw error; });
  }
}

/** Keep raw command inputs and all-or-nothing output on caller-authorized
 * retained storage. Ordered bbox output uses the same retained publication path. */
export async function executeRetainedRawText(context: CommandContext, plan: RawTextPlan, stdout: ByteSink, signal: AbortSignal, maxInputBytes = Infinity): Promise<{ exitCode: number }> {
  const encoder = new TextEncoder(), inputPath = plan.inputFile ?? "-", outputPath = plan.outputFile ?? "-";
  const warning = plan.invalidEolWarning ? "Bad '-eol' value on command line\n" : "";
  async function error(message: string, exitCode: number, includeWarning = true) {
    if (!plan.quiet) await writeBytes(context.stderr, encoder.encode((includeWarning ? warning : "") + message), signal);
    return { exitCode };
  }
  const directory = resolvePath(context.cwd, context.env.TMPDIR || "/tmp");
  const storage = new PdfStagingStorage({ fs: context.fs, directory });
  let source: PdfFileSource | undefined, document: PdfRetainedDocument | undefined, result: PdfFileSource | undefined, failed = false;
  try {
    await context.fs.mkdir(directory, { recursive: true, signal });
    const maximum = Math.min(maxInputBytes, context.inputBudget?.maxBytes ?? Infinity);
    try {
      if (inputPath === "-") {
        async function* input() {
          let total = 0, turns = 0;
          for await (const bytes of readBytes(context.stdin, signal)) {
            if (++turns % 64 === 0) await yieldTurn(signal);
            total += bytes.length; context.inputBudget?.check(total); yield bytes;
          }
        }
        source = await PdfFileSource.fromStream(storage.fs, directory, input(), { maxInputBytes: maximum, signal });
      } else {
        const path = resolvePath(context.cwd, inputPath);
        context.inputBudget?.check((await context.fs.stat(path, { signal })).size);
        source = await PdfFileSource.open(context.fs, path, { maxInputBytes: maximum, signal });
        context.inputBudget?.check(source.size);
      }
    } catch (failure) {
      signal.throwIfAborted();
      if (failure instanceof Error && "code" in failure && failure.code === "ENOENT") {
        return await error(`I/O Error: Couldn't open file '${inputPath}': No such file or directory.\n`, 1, false);
      }
      throw failure;
    }
    if (!source.size) return await error("Syntax Error: Document stream is empty\n", 1);
    let pageCount = 0;
    try {
      const password = plan.opw ?? plan.upw;
      document = await PdfRetainedDocument.open(source, storage, { recovery: "repair", signal, ...(password !== undefined ? { password } : {}) });
      for await (const ignored of document.pages()) { void ignored; pageCount++; await yieldTurn(signal); }
    } catch (failure) {
      signal.throwIfAborted();
      if (!(failure instanceof PdfError)) throw failure;
      if (failure.code === "E_PASSWORD" || (failure.code === "E_CAPABILITY" && failure.message === "Invalid PDF password")) return await error("Command Line Error: Incorrect password\n", 1);
      if (failure.code !== "E_PARSE") throw failure;
      return await error(`Syntax Error: ${failure.message}\n`, 1);
    }
    const first = Math.max(1, plan.firstPage);
    const last = !plan.lastPageExplicit || plan.lastPage === 0 || plan.lastPage > pageCount ? pageCount : plan.lastPage;
    if (first > pageCount || first > last) return await error(`Command Line Error: Wrong page range given: the first page (${first}) can not be after the last page (${last}).\n`, 99);
    const retained = document; let emptyPageWarning = false;
    async function* text() {
      if (plan.bbox) yield* streamTextHtmlStart(await retained.info(), "doc");
      else if (plan.tsv) yield encoder.encode("level\tpage_num\tpar_num\tblock_num\tline_num\tword_num\tleft\ttop\twidth\theight\tconf\ttext\n");
      for await (const page of retained.pages()) {
        await yieldTurn(signal);
        if (page.index + 1 < first) continue;
        if (page.index + 1 > last) break;
        const geometry = await rawGeometry(retained, page, plan);
        if (plan.bbox) {
          const hasWords = yield* streamRawBboxPage(page, storage, geometry!, { ...plan, signal });
          if (!hasWords && !plan.bboxLayout && !plan.quiet) emptyPageWarning = true;
          continue;
        }
        if (plan.tsv) {
          // Raw TSV has page rows only, but still evaluate content so retained
          // reads, decoding, validation and cancellation follow extraction.
          for await (const ignored of page.evaluateSteps(storage, { signal })) { void ignored; }
          yield encoder.encode(`1\t${page.index + 1}\t0\t0\t0\t0\t0.000000\t0.000000\t${geometry!.width.toFixed(6)}\t${geometry!.height.toFixed(6)}\t-1\t###PAGE###\n`);
          continue;
        }
        const crop = geometry?.crop;
        const textOptions={...(crop?{crop}:{}),rejoinHyphens:!plan.raw&&plan.removeHyphens,discardDiagonal:plan.nodiag,clipText:plan.clip,colSpacing:plan.colspacing,signal};
        const raw = plan.raw?page.streamRawText(storage,textOptions):page.streamLogicalText(storage,textOptions);
        let lastByte: number | undefined;
        if (!plan.urls) { for await(const bytes of raw){lastByte=bytes.at(-1)??lastByte;yield bytes;} }
        else {
          const names = new PdfNameIndex(storage, Infinity, signal);
          let body: PdfFileSource | undefined, pageFailed = false;
          try {
            body = await PdfFileSource.fromStream(storage.fs, directory, raw, { signal });
            for await (const bytes of body.stream(0, body.size, signal)) { lastByte = bytes.at(-1) ?? lastByte; yield bytes; }
            for await (const annotation of page.annotations()) {
              const uri = annotation.uri;
              if (!uri || !(await names.intern(uri)).added || await containsText(body, uri, signal)) continue;
              if (lastByte !== undefined && lastByte !== 10) yield new Uint8Array([10]);
              yield encoder.encode(uri); yield new Uint8Array([10]); lastByte = 10;
            }
          } catch (failure) { pageFailed = true; throw failure; }
          finally {
            const results = await Promise.allSettled([body?.close(), names.close()]);
            if (!pageFailed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
          }
        }
        if(!plan.raw&&lastByte!==undefined){if(lastByte!==10)yield new Uint8Array([10]);yield new Uint8Array([10]);}
        if (!plan.nopgbrk) yield new Uint8Array([12]);
      }
      if (plan.bbox) yield encoder.encode("</doc>\n</body>\n</html>\n");
    }
    const formatted = plan.htmlmeta && !plan.bbox
      ? streamTextHtml(encodePopplerChunks(text(), "UTF-8", plan.tsv ? "unix" : plan.eol), await document.info()) : text();
    result = await PdfFileSource.fromStream(storage.fs, directory, encodePopplerChunks(formatted, plan.encoding, plan.htmlmeta || plan.tsv || plan.bbox ? "unix" : plan.eol), { signal });
    if (warning || emptyPageWarning) await writeBytes(context.stderr, encoder.encode(warning + (emptyPageWarning ? "no word list\n" : "")), signal);
    if (outputPath === "-") {
      for await (const bytes of result.stream(0, result.size, signal)) await writeBytes(stdout, bytes, signal);
    } else {
      try { await publish(context, resolvePath(context.cwd, outputPath), result, signal); }
      catch (failure) {
        signal.throwIfAborted();
        if (!(failure instanceof Error) || !("code" in failure)) throw failure;
        return await error(`I/O Error: Couldn't open text file '${outputPath}'\n`, 2, false);
      }
    }
    return { exitCode: 0 };
  } catch (failure) { failed = true; throw failure; }
  finally {
    const closed = await Promise.allSettled([document?.close(), source?.close(), result?.close()]);
    if (!failed) for (const entry of closed) if (entry.status === "rejected") await Promise.reject(entry.reason);
  }
}

/** Search staged UTF-8 text without retaining the page. Only one annotation's
 * overlap is live; individual COS string admission remains the parser's job. */
async function containsText(source: PdfFileSource, needle: string, signal: AbortSignal): Promise<boolean> {
  const decoder = new TextDecoder(); let overlap = "";
  for await (const bytes of source.stream(0, source.size, signal)) {
    await yieldTurn(signal);
    const text = overlap + decoder.decode(bytes, { stream: true });
    if (text.includes(needle)) return true;
    overlap = needle.length > 1 ? text.slice(-(needle.length - 1)) : "";
  }
  return (overlap + decoder.decode()).includes(needle);
}

async function rawGeometry(document: PdfRetainedDocument, page: PdfRetainedPage, plan: RawTextPlan): Promise<RawTextGeometry | undefined> {
  let box: number[] | undefined;
  if (plan.cropbox) {
    let current: PdfCosDict | undefined = page.dict, depth = 0; const visited = new Set<number>();
    while (current) {
      if (++depth > document.depthLimit) throw new PdfError("E_LIMIT", "PDF inherited crop depth limit exceeded");
      const candidate = (await document.lookup(dictGet(current, "CropBox")))?.value;
      if (candidate?.kind === "array" && candidate.items.length >= 4) {
        box = []; for (const item of candidate.items.slice(0, 4)) { const value = (await document.lookup(item))?.value; box.push(value?.kind === "number" ? value.value : 0); } break;
      }
      const parent = dictGet(current, "Parent");
      if (parent?.kind === "ref") { if (visited.has(parent.objectNumber)) break; visited.add(parent.objectNumber); }
      const value = (await document.lookup(parent))?.value; current = value?.kind === "dict" ? value : undefined;
    }
  }
  const cropping = box !== undefined || plan.cropX !== undefined || plan.cropY !== undefined || plan.cropW !== undefined || plan.cropH !== undefined;
  if (!cropping && !plan.tsv && !plan.bbox) return undefined;
  const { mediaBox } = await page.attributes(), width = Math.abs(mediaBox[2] - mediaBox[0]), height = Math.abs(mediaBox[3] - mediaBox[1]), scale = plan.resolution / 72;
  const x0 = box ? Math.min(box[0]!, box[2]!) : 0, y0 = box ? Math.min(box[1]!, box[3]!) : 0;
  const x1 = box ? Math.max(box[0]!, box[2]!) : width, y1 = box ? Math.max(box[1]!, box[3]!) : height;
  const minX = x0 + (plan.cropX ?? 0) / scale, minTop = height - y1 + (plan.cropY ?? 0) / scale;
  const maxX = plan.cropW !== undefined && plan.cropW > 0 ? minX + plan.cropW / scale : x1;
  const maxTop = plan.cropH !== undefined && plan.cropH > 0 ? minTop + plan.cropH / scale : height - y0;
  return { ...(cropping ? { crop: [minX, height - maxTop, maxX, height - minTop] as const } : {}),
    offsetX: box ? x0 : 0, offsetY: box ? y0 : 0,
    width: box ? Math.max(1, x1 - x0) : width, height: box ? Math.max(1, y1 - y0) : height };
}
