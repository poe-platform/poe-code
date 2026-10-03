import { FsError } from "safe-bash-contracts/errors";
import { resolvePath } from "safe-bash-contracts/path";
import { drainCooperativeSteps as drainSteps } from "safe-bash-contracts/yield";
import { InputByteBudget } from "safe-bash-contracts/io";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import {
  commandRuntimeIdentity,
  getCommandArguments,
  type CommandContext,
  type CommandDefinition,
} from "safe-bash-contracts/command";
import { readBytes, writeBytes } from "safe-bash-contracts/io";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { PdfFileSource, PdfRetainedDocument, PdfRetainedDecodedImage, PdfStagedOutputs, PdfNameIndex, PdfError, dictGet, pdfImageCodec, encodeRetainedPng, encodeRetainedTiff, encodePortableBitmapChunks, type PdfOutputEntry, PdfDocument, encodePbmSteps, encodePngSteps, encodePpmSteps, encodeTiffSteps, extractDocumentImagesSteps } from "@poe-code/pdf-ast";

export interface PdfimagesLimits {
  readonly maxInputBytes: number;
}

export interface PdfimagesCommandOptions {
  readonly limits?: Partial<PdfimagesLimits>;
  readonly replace?: boolean;
}

export interface PdfimagesCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

function formatPopplerSize(byteLength: number): string {
  if (byteLength >= 1024 * 1024) {
    return `${(byteLength / (1024 * 1024)).toFixed(1)}M`;
  }
  if (byteLength >= 1024) {
    return `${(byteLength / 1024).toFixed(1)}K`;
  }
  return `${byteLength}B`;
}

function formatPopplerRatio(
  byteLength: number,
  width: number,
  height: number,
  components: number,
  bpc: number
): string {
  const uncompressedBits = Math.max(1, width * height * components * bpc);
  const uncompressedBytes = Math.max(1, uncompressedBits / 8);
  const pct = Math.min(999, Math.max(0.1, (byteLength / uncompressedBytes) * 100));
  return `${pct.toFixed(1)}%`;
}

const PDFIMAGES_VALUE_FLAGS = new Set(["-f", "-l", "-upw", "-opw", "-min-width", "-min-height"]);

interface PdfimagesPlan {
  listOnly: boolean;
  usePng: boolean;
  useJpeg: boolean;
  useTiff: boolean;
  useJp2: boolean;
  useJbig2: boolean;
  useCcitt: boolean;
  firstPage: number;
  lastPage: number;
  minWidth: number;
  minHeight: number;
  includePage: boolean;
  uniqueOnly: boolean;
  printFilenames: boolean;
  quiet: boolean;
  password: string;
  positionals: string[];
  inputPath: string;
}
function* parsePdfimagesArgs(argv: readonly string[]): Generator<void, PdfimagesPlan | PdfimagesCliResult, void> {
    let cooperativeWork = 63;
    let listOnly = false;
    let usePng = false;
    let useJpeg = false;
    let useTiff = false;
    let useJp2 = false;
    let useJbig2 = false;
    let useCcitt = false;
    let firstPage = 1;
    let lastPage = 0;
    let minWidth = 0;
    let minHeight = 0;
    let includePage = false;
    let uniqueOnly = false;
    let printFilenames = false;
    let quiet = false;
    let password = "";
    const positionals: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const arg = argv[i]!;
        if (arg === "--") {
            positionals.push(...argv.slice(i + 1));
            break;
        }
        if (PDFIMAGES_VALUE_FLAGS.has(arg)) {
            const value = argv[i + 1];
            if (value === undefined) {
                return { exitCode: 99, stdout: "", stderr: `Missing value for '${arg}'\n` };
            }
            if (arg === "-f" || arg === "-l" || arg === "-min-width" || arg === "-min-height") {
                const unsigned = value.startsWith("+") || value.startsWith("-") ? value.slice(1) : value;
                if (unsigned.length === 0 || !Number.isSafeInteger(Number(value)) || ![...unsigned].every(char => char >= "0" && char <= "9")) {
                    return { exitCode: 99, stdout: "", stderr: `Bad '${arg}' value on command line\n` };
                }
            }
        }
        if (arg === "-v" || arg === "--version") {
            return { exitCode: 0, stdout: "pdfimages version 24.08.0\n", stderr: "" };
        }
        if (arg === "-h" || arg === "-help" || arg === "--help" || arg === "-?") {
            return {
                exitCode: 0,
                stdout: "Usage: pdfimages [options] <PDF-file> <image-root>\n       pdfimages -list [options] <PDF-file>\n  -list / -png / -j / -all / -f <int> / -l <int> / -p\n  -min-width <int> / -min-height <int> : ignore smaller images\n",
                stderr: "",
            };
        }
        if (arg === "-list")
            listOnly = true;
        else if (arg === "-png")
            usePng = true;
        else if (arg === "-j")
            useJpeg = true;
        else if (arg === "-tiff")
            useTiff = true;
        else if (arg === "-jp2")
            useJp2 = true;
        else if (arg === "-jbig2")
            useJbig2 = true;
        else if (arg === "-ccitt")
            useCcitt = true;
        else if (arg === "-all") {
            usePng = true;
            useJpeg = true;
            useJp2 = true;
            useJbig2 = true;
            useCcitt = true;
        }
        else if (arg === "-p")
            includePage = true;
        else if (arg === "-u")
            uniqueOnly = true;
        else if (arg === "-print-filenames")
            printFilenames = true;
        else if (arg === "-q")
            quiet = true;
        else if (arg === "-f") {
            firstPage = Math.max(1, Number.parseInt(argv[++i] ?? "1", 10) || 1);
        }
        else if (arg === "-l") {
            lastPage = Math.max(0, Number.parseInt(argv[++i] ?? "0", 10) || 0);
        }
        else if (arg === "-min-width") {
            minWidth = Number(argv[++i]);
        }
        else if (arg === "-min-height") {
            minHeight = Number(argv[++i]);
        }
        else if (arg === "-upw" || arg === "-opw") {
            password = argv[++i] ?? "";
        }
        else if (!arg.startsWith("-") || arg === "-") {
            positionals.push(arg);
        }
        else {
            return { exitCode: 99, stdout: "", stderr: `Unknown option '${arg}'\n` };
        }
    }
    const inputPath = positionals[0];
    if (!inputPath || positionals.length !== (listOnly ? 1 : 2)) {
        return { exitCode: 99, stdout: "", stderr: listOnly
            ? "Usage: pdfimages -list [options] <PDF-file>\n"
            : "Usage: pdfimages [options] <PDF-file> <image-root>\n" };
    }
    return { listOnly, usePng, useJpeg, useTiff, useJp2, useJbig2, useCcitt, firstPage, lastPage, minWidth, minHeight, includePage, uniqueOnly, printFilenames, quiet, password, positionals, inputPath };
}

type ImageListing = Omit<import("@poe-code/pdf-ast").PdfExtractedImage, "bitmap">;
function formatImageRow(img: ImageListing, idx: number): string {
        const objField = img.inline || !img.objectId
            ? "  [inline]"
            : `${String(img.objectId.objNum).padStart(6)} ${String(img.objectId.genNum).padStart(2)}`;
        const sizeStr = formatPopplerSize(img.byteLength).padStart(5);
        const ratioStr = formatPopplerRatio(img.byteLength, img.width, img.height, img.components, img.bitsPerComponent).padStart(5);
        const interpStr = (img.interpolate ? "yes" : "no").padStart(6);
        const colorCol = (img.colorSpaceLabel ?? img.colorSpace).padEnd(5);
        return `${String(img.pageNumber).padStart(4)} ${String(idx).padStart(5)} ${img.type.padEnd(6)} ${String(img.width).padStart(5)} ${String(img.height).padStart(6)} ${colorCol} ${String(img.components).padStart(4)} ${String(img.bitsPerComponent).padStart(3)}  ${img.encoding.padEnd(5)} ${interpStr} ${objField} ${String(img.xPpi).padStart(5)} ${String(img.yPpi).padStart(5)} ${sizeStr} ${ratioStr}`;
}

function* runPdfimagesCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, options: {
    readonly signal?: AbortSignal;
    readonly onAllocateBytes?: (bytes: number) => void;
} = {}): Generator<void, PdfimagesCliResult, void> {
    let cooperativeWork = 63;
    const plan = yield* parsePdfimagesArgs(argv);
    if ("exitCode" in plan) return plan;
    const { listOnly, usePng, useJpeg, useTiff, useJp2, useJbig2, useCcitt, firstPage, lastPage, minWidth, minHeight, includePage, uniqueOnly, printFilenames, quiet, password, positionals, inputPath } = plan;
    const pdfBytes = files.get(inputPath);
    if (!pdfBytes) {
        return { exitCode: 1, stdout: "", stderr: quiet ? "" : `I/O Error: Couldn't open file '${inputPath}'\n` };
    }
    if (pdfBytes.byteLength === 0) {
        return { exitCode: 1, stdout: "", stderr: quiet ? "" : "Syntax Error: Document stream is empty\n" };
    }
    let doc: PdfDocument;
    try {
        doc = PdfDocument.load(pdfBytes, password ? { password } : undefined);
    }
    catch (err) {
        return { exitCode: 1, stdout: "", stderr: quiet ? "" : `PDF Error: ${(err as Error).message}\n` };
    }
    const totalPages = Math.max(1, doc.pageCount);
    const endPage = lastPage > 0 ? Math.min(totalPages, lastPage) : totalPages;
    if (firstPage > totalPages || firstPage > endPage) {
        return {
            exitCode: 99,
            stdout: "",
            stderr: quiet
                ? ""
                : `Command Line Error: Wrong page range given: the first page (${firstPage}) can not be after the last page (${endPage}).\n`,
        };
    }
    const allExtracted = (yield* extractDocumentImagesSteps(doc.cos, {
        firstPage,
        ...(lastPage > 0 ? { lastPage } : {}),
        signal: options.signal
    }));
    const seenObjectIds = new Set<string>();
    const sizedImages = allExtracted.filter(img => img.width >= minWidth && img.height >= minHeight);
    const extracted = uniqueOnly
        ? sizedImages.filter((img) => {
            if (img.inline || !img.objectId)
                return true;
            const key = `${img.objectId.objNum}:${img.objectId.genNum}`;
            if (seenObjectIds.has(key))
                return false;
            seenObjectIds.add(key);
            return true;
        })
        : sizedImages;
    const listLines = [
        "page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio",
        "--------------------------------------------------------------------------------------------",
    ];
    const root = positionals[1]!;
    const printedFilenames: string[] = [];
    for (let idx = 0; idx < extracted.length; idx++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const img = extracted[idx]!;
        const numStr = String(idx).padStart(3, "0");
        listLines.push(formatImageRow(img, idx));
        if (!listOnly) {
            let ext: string;
            let outBytes: Uint8Array;
            if (useJpeg && img.encoding === "jpeg" && img.rawJpegBytes) {
                ext = "jpg";
                outBytes = img.rawJpegBytes;
            }
            else if (useJp2 && img.encoding === "jpx" && img.rawEncodedBytes) {
                ext = "jp2";
                outBytes = img.rawEncodedBytes;
            }
            else if (useJbig2 && img.encoding === "jbig2" && img.rawEncodedBytes) {
                ext = "jb2e";
                outBytes = img.rawEncodedBytes;
            }
            else if (useCcitt && img.encoding === "ccitt" && img.rawEncodedBytes) {
                ext = "ccitt";
                outBytes = img.rawEncodedBytes;
            }
            else if (useTiff) {
                ext = "tif";
                outBytes = (yield* encodeTiffSteps(img.bitmap, img.xPpi));
            }
            else if (usePng) {
                ext = "png";
                outBytes = (yield* encodePngSteps(img.bitmap));
            }
            else if (img.colorSpace === "gray" && img.bitsPerComponent === 1) {
                ext = "pbm";
                outBytes = (yield* encodePbmSteps(img.bitmap));
            }
            else {
                ext = "ppm";
                outBytes = (yield* encodePpmSteps(img.bitmap));
            }
            const outName = includePage
                ? `${root}-${String(img.pageNumber).padStart(3, "0")}-${numStr}.${ext}`
                : `${root}-${numStr}.${ext}`;
            options.onAllocateBytes?.(img.width * img.height * 4 + outBytes.byteLength);
            files.set(outName, outBytes);
            if (ext === "jb2e" && img.jbig2GlobalsBytes) {
                const jb2gName = includePage
                    ? `${root}-${String(img.pageNumber).padStart(3, "0")}-${numStr}.jb2g`
                    : `${root}-${numStr}.jb2g`;
                files.set(jb2gName, img.jbig2GlobalsBytes);
                if (printFilenames)
                    printedFilenames.push(jb2gName);
            }
            if (ext === "ccitt") {
                const paramsBase = includePage
                    ? `${root}-${String(img.pageNumber).padStart(3, "0")}-${numStr}.params`
                    : `${root}-${numStr}.params`;
                const kVal = img.ccittParams?.k ?? 0;
                const kFlag = kVal < 0 ? "-4" : kVal > 0 ? "-2" : "-1";
                const extraFlags = [
                    kFlag,
                    `-x ${img.width}`,
                    `-y ${img.height}`,
                    ...(img.ccittParams?.blackIs1 ? ["-B"] : []),
                    ...(img.ccittParams?.byteAlign ? ["-A"] : []),
                ].join(" ");
                files.set(paramsBase, new TextEncoder().encode(`${extraFlags}\n`));
                if (printFilenames)
                    printedFilenames.push(paramsBase);
            }
            if (printFilenames)
                printedFilenames.push(outName);
        }
    }
    if (listOnly) {
        return { exitCode: 0, stdout: listLines.join("\n") + "\n", stderr: "" };
    }
    if (printFilenames && printedFilenames.length > 0) {
        return { exitCode: 0, stdout: printedFilenames.join("\n") + "\n", stderr: "" };
    }
    return { exitCode: 0, stdout: "", stderr: "" };
}
export async function runPdfimagesCli(argv: readonly string[], files: Map<string, Uint8Array>, options: {
    readonly signal?: AbortSignal;
    readonly onAllocateBytes?: (bytes: number) => void;
} = {}): Promise<PdfimagesCliResult> {
    return drainSteps(runPdfimagesCliSteps(argv, files, options), options.signal);
}
export function runPdfimagesCliSync(argv: readonly string[], files: Map<string, Uint8Array>, options: {
    readonly signal?: AbortSignal;
    readonly onAllocateBytes?: (bytes: number) => void;
} = {}): PdfimagesCliResult {
    const steps = runPdfimagesCliSteps(argv, files, options);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}

/** Execute image extraction through the caller's retained filesystem. */
export async function executePdfimages(context: CommandContext, options: PdfimagesCommandOptions = {}): Promise<{ exitCode: number }> {
  const invocation = createOutputOperation(context, { write: async () => {} });
  const signal = invocation.signal, stdout = invocation.child(context.stdout).output;
  const emit = (text: string) => writeBytes(stdout, new TextEncoder().encode(text), signal);
  let plan: PdfimagesPlan | PdfimagesCliResult = { exitCode: 0, stdout: "", stderr: "" };
  const error = async (text: string, exitCode: number) => { if (!("quiet" in plan && plan.quiet)) await writeBytes(context.stderr, new TextEncoder().encode(text), signal); return { exitCode }; };
  let source: PdfFileSource | undefined, document: PdfRetainedDocument | undefined, outputs: PdfStagedOutputs | undefined, seen: PdfNameIndex | undefined;
  let failed = false;
  try {
    plan = await drainSteps(parsePdfimagesArgs(getCommandArguments(context).args), signal);
    if ("exitCode" in plan) { if (plan.stdout) await emit(plan.stdout); return await error(plan.stderr, plan.exitCode); }
    const storage = { fs: context.fs, directory: resolvePath(context.cwd, context.env.TMPDIR || "/tmp") };
    const maxInputBytes = Math.min(InputByteBudget.limit(options.limits?.maxInputBytes), context.inputBudget?.maxBytes ?? Infinity);
    try {
      if (plan.inputPath === "-") {
        async function* input() { let total = 0; for await (const bytes of readBytes(context.stdin, signal)) { total += bytes.length; context.inputBudget?.check(total); yield bytes; } }
        source = await PdfFileSource.fromStream(context.fs, storage.directory, input(), { maxInputBytes, signal });
      } else {
        source = await PdfFileSource.open(context.fs, resolvePath(context.cwd, plan.inputPath), { maxInputBytes, signal });
        context.inputBudget?.check(source.size);
      }
    } catch (failure) {
      signal.throwIfAborted();
      if (failure instanceof Error && "code" in failure && failure.code === "ENOENT") return await error(`I/O Error: Couldn't open file '${plan.inputPath}'\n`, 1);
      throw failure;
    }
    if (!source.size) return await error("Syntax Error: Document stream is empty\n", 1);
    try { document = await PdfRetainedDocument.open(source, storage, { password: plan.password, recovery: "repair", signal }); }
    catch (failure) {
      signal.throwIfAborted();
      if (failure instanceof PdfError && (failure.code === "E_LIMIT" || failure.code === "E_CAPABILITY")) throw failure;
      return await error(`PDF Error: ${(failure as Error).message}\n`, 1);
    }
    let count = 0; for await (const ignored of document.pages()) count++;
    const endPage = plan.lastPage > 0 ? Math.min(Math.max(1, count), plan.lastPage) : Math.max(1, count);
    if (plan.firstPage > endPage) return await error(`Command Line Error: Wrong page range given: the first page (${plan.firstPage}) can not be after the last page (${endPage}).\n`, 99);
    const doc = document, selection = plan;
    const identities = seen = new PdfNameIndex(storage, Infinity, signal);
    async function* images() {
      let idx = 0;
      for await (const occurrence of doc.images({ firstPage: selection.firstPage, lastPage: endPage })) {
        const decoded = await PdfRetainedDecodedImage.open(doc, occurrence, storage, { signal });
        let imageFailed = false;
        try {
          if (decoded.width < selection.minWidth || decoded.height < selection.minHeight) continue;
          const ref = occurrence.reference;
          if (selection.uniqueOnly && ref && !(await identities.intern(`${ref.objectNumber}:${ref.generationNumber}`)).added) continue;
          const resolve = async (key: string, alias?: string) => (await doc.lookup(dictGet(occurrence.dict, key) ?? (alias ? dictGet(occurrence.dict, alias) : undefined)))?.value;
          const mask = await resolve("ImageMask", "IM"), interpolate = await resolve("Interpolate", "I");
          const [a,b,c,d] = occurrence.matrix;
          const ppi = (pixels: number, extent: number) => extent > 1e-6 ? Math.max(1, Math.round(pixels * 72 / extent)) : 72;
          const metadata: ImageListing = { pageNumber: occurrence.pageNumber, imageIndex: idx, type: mask?.kind === "boolean" && mask.value ? "stencil" : "image", objectId: ref ? { objNum: ref.objectNumber, genNum: ref.generationNumber } : undefined,
            inline: occurrence.inline, width: decoded.width, height: decoded.height, colorSpace: decoded.color.colorSpace, colorSpaceLabel: mask?.kind === "boolean" && mask.value ? "-" : decoded.color.colorSpaceLabel ?? decoded.color.colorSpace,
            components: decoded.color.components, bitsPerComponent: decoded.bitsPerComponent, encoding: decoded.encoding, interpolate: interpolate?.kind === "boolean" && interpolate.value,
            xPpi: ppi(decoded.width, Math.hypot(a,b)), yPpi: ppi(decoded.height, Math.hypot(c,d)), byteLength: occurrence.byteLength };
          const filter = await resolve("Filter", "F"), parms = await resolve("DecodeParms", "DP");
          let parameter = parms;
          if (parms?.kind === "array") {
            const filters = filter?.kind === "array" ? filter.items : filter ? [filter] : [];
            let slot = 0; for (; slot < filters.length; slot++) { const node = (await doc.lookup(filters[slot]))?.value; if (node?.kind === "name" && pdfImageCodec(node.decoded) === decoded.encoding) break; }
            parameter = (await doc.lookup(parms.items[slot]))?.value;
          }
          // Buffered inline extraction exposes default CCITT sidecar parameters.
          const value = async (key: string) => !occurrence.inline && parameter?.kind === "dict" ? (await doc.lookup(dictGet(parameter,key)))?.value : undefined;
          const k = await value("K"), black = await value("BlackIs1"), align = await value("EncodedByteAlign");
          yield { decoded, metadata, idx: idx++, ccitt: { k: k?.kind === "number" ? k.value : 0, black: black?.kind === "boolean" && black.value, align: align?.kind === "boolean" && align.value } };
        } catch (failure) { imageFailed = true; throw failure; } finally { await decoded.close().catch(failure => { if (!imageFailed) throw failure; }); }
      }
    }
    async function* text(value: string) { yield new TextEncoder().encode(value); }
    async function* entries(): AsyncGenerator<PdfOutputEntry> {
      if (selection.listOnly) {
        async function* listing() {
          yield new TextEncoder().encode("page   num  type   width height color comp bpc  enc interp  object ID x-ppi y-ppi size ratio\n--------------------------------------------------------------------------------------------\n");
          for await (const { metadata, idx } of images()) yield new TextEncoder().encode(formatImageRow(metadata, idx) + "\n");
        }
        yield { name: "stdout", chunks: listing() }; return;
      }
      for await (const { decoded, metadata, idx, ccitt } of images()) {
        const native = decoded.nativeByteLength !== undefined;
        const ext = native && selection.useJpeg && decoded.encoding === "jpeg" ? "jpg" : native && selection.useJp2 && decoded.encoding === "jpx" ? "jp2" : native && selection.useJbig2 && decoded.encoding === "jbig2" ? "jb2e" : native && selection.useCcitt && decoded.encoding === "ccitt" ? "ccitt" : selection.useTiff ? "tif" : selection.usePng ? "png" : decoded.color.colorSpace === "gray" && decoded.bitsPerComponent === 1 ? "pbm" : "ppm";
        const base = `${selection.positionals[1]}-${selection.includePage ? String(metadata.pageNumber).padStart(3,"0") + "-" : ""}${String(idx).padStart(3,"0")}`;
        const chunks = ext === "png" ? encodeRetainedPng(decoded.width,decoded.height,decoded.rows(),storage,{signal}) : ext === "tif" ? encodeRetainedTiff(decoded.width,decoded.height,decoded.rows(),storage,{dpi:metadata.xPpi,signal}) : ext === "ppm" || ext === "pbm" ? encodePortableBitmapChunks(ext,decoded.width,decoded.height,decoded.rows(),{signal}) : decoded.nativeContents();
        yield { name: `${base}.${ext}`, chunks };
        if (ext === "jb2e" && decoded.globalsByteLength !== undefined && !metadata.inline) yield { name: `${base}.jb2g`, chunks: decoded.nativeContents("globals") };
        if (ext === "ccitt") yield { name: `${base}.params`, chunks: text([ccitt.k < 0 ? "-4" : ccitt.k > 0 ? "-2" : "-1", `-x ${decoded.width}`, `-y ${decoded.height}`, ...(ccitt.black ? ["-B"] : []), ...(ccitt.align ? ["-A"] : [])].join(" ") + "\n") };
      }
    }
    outputs = await PdfStagedOutputs.create(storage, entries(), { signal });
    if (plan.listOnly) { for await (const entry of outputs.entries()) for await (const bytes of entry.contents()) await writeBytes(stdout, bytes, signal); return { exitCode: 0 }; }
    if (plan.printFilenames) {
      let pending: string | undefined;
      for await (const entry of outputs.entries()) {
        if (entry.name.endsWith(".params") || entry.name.endsWith(".jb2g")) await emit(entry.name + "\n");
        else { if (pending !== undefined) await emit(pending + "\n"); pending = entry.name; }
      }
      if (pending !== undefined) await emit(pending + "\n");
    }
    for await (const entry of outputs.entries()) {
      try { await publishPdfOutput(context, resolvePath(context.cwd, entry.name), entry.contents(), signal); }
      catch (failure) { signal.throwIfAborted(); if (!(failure instanceof Error) || !("code" in failure)) throw failure; return await error(`I/O Error: Couldn't open image file '${entry.name}'\n`, 2); }
    }
    return { exitCode: 0 };
  } catch (failure) { failed = true; throw failure; } finally {
    const results = await Promise.allSettled([outputs?.close(), seen?.close(), document?.close(), source?.close(), invocation.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}

export function createPdfimagesCommand(options: PdfimagesCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "pdfimages",
    runtimeIdentity: commandRuntimeIdentity,
    description: "List and extract embedded images from PDF pages via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return executePdfimages(context, { limits: { maxInputBytes } });
    },
  });
}

export const pdfimagesCommand: CommandDefinition = createPdfimagesCommand();

export function pdfimagesPlugin(options: PdfimagesCommandOptions = {}): VirtualShellPlugin {
  const cmd = createPdfimagesCommand(options);
  const replace = options.replace ?? false;
  return {
    name: "pdfimages",
    setup(host) {
      host.commands.register(cmd, { replace });
    },
  };
}

export const pdfimagesCommands = pdfimagesPlugin;

export type PdfimagesCommandsOptions = PdfimagesCommandOptions;

export function createPdfimagesCommands(options: PdfimagesCommandsOptions = {}): readonly CommandDefinition[] {
    return [createPdfimagesCommand(options)];
}



async function publishPdfOutput(context: CommandContext, path: string, chunks: AsyncIterable<Uint8Array>, signal: AbortSignal): Promise<void> {
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

