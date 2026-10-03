import { VALUE_FLAGS, CAIRO_VALUE_FLAGS, parsePdftoppmArgsSteps, parsePdftocairoArgsSteps } from "./parse.js";
import { executeRetainedRaster } from "./retained.js";
import { resolvePath } from "safe-bash-contracts/path";
import { yieldTurn, drainCooperativeSteps as drainSteps } from "safe-bash-contracts/yield";
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
import { PdfDocument, cosArray, cosNumber, dictSet, getDisplayListCropBox, type PdfCropRect, decodePngSteps, encodeJpegSteps, encodePbmSteps, encodePgmSteps, encodePngSteps, encodePpmSteps, encodeTiffSteps, renderDisplayListToSvgSteps, renderDisplayListToBitmapSteps } from "@poe-code/pdf-ast";

export interface PdftoppmLimits {
  readonly maxInputBytes: number;
}

export interface PdftoppmCommandOptions {
  readonly limits?: Partial<PdftoppmLimits>;
  readonly replace?: boolean;
}

export interface PdftoppmCliResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly stdoutBytes?: Uint8Array | undefined;
}

function extractPdftoppmPositionals(argv: readonly string[]): string[] {
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") {
      pos.push(arg);
    }
  }
  return pos;
}

function* runPdftoppmCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, options: {
    readonly signal?: AbortSignal;
    readonly onAllocateBytes?: (bytes: number) => void;
} = {}): Generator<void, PdftoppmCliResult, void> {
    const parsed = yield* parsePdftoppmArgsSteps(argv, files.has("-"));
    if (!("inputPath" in parsed)) return parsed;
    const { format, colorMode, dpi, dpiX, dpiY, scaleTo, scaleToX, scaleToY, firstPage, lastPage, oddOnly, evenOnly, singleFile, forceNum, sep, setPageNo, cropX, cropY, cropW, cropH, hasCrop, useCropBox, hideAnnotations, transparent, progress, quiet, jpegQuality, tiffCompression, antialiasText, antialiasVector, thinLineMode, password, positionals, inputPath } = parsed;
    let cooperativeWork = 63;
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
    const prefix = positionals[1];
    const ext = format;
    const padWidth = Math.max(1, String(totalPages).length);
    const outChunks: Uint8Array[] = [];
    const progressLines: string[] = [];
    for (let p = firstPage; p <= endPage; p++) {
        yield;
        if (oddOnly && p % 2 === 0)
            continue;
        if (evenOnly && p % 2 === 1)
            continue;
        const page = doc.getPage(p - 1);
        const displayList = page.evaluateDisplayList({ hideAnnotations });
        const box = useCropBox ? getDisplayListCropBox(displayList) : [0, 0, displayList.width, displayList.height];
        const rawSize = { width: box[2]! - box[0]!, height: box[3]! - box[1]! };
        const rot = page.getRotation();
        const ptW = rot === 90 || rot === 270 ? rawSize.height : rawSize.width;
        const ptH = rot === 90 || rot === 270 ? rawSize.width : rawSize.height;
        let effDpiX = dpiX ?? dpi;
        let effDpiY = dpiY ?? dpi;
        if (scaleTo > 0) {
            const factor = (scaleTo * 72) / Math.max(ptW, ptH, 1);
            effDpiX = factor;
            effDpiY = factor;
        }
        else {
            if (scaleToX > 0) {
                effDpiX = (scaleToX * 72) / Math.max(ptW, 1);
                if (scaleToY < 0)
                    effDpiY = effDpiX;
            }
            if (scaleToY > 0) {
                effDpiY = (scaleToY * 72) / Math.max(ptH, 1);
                if (scaleToX < 0)
                    effDpiX = effDpiY;
            }
        }
        const cropRect: PdfCropRect | undefined = hasCrop
            ? { x: cropX, y: cropY, width: cropW, height: cropH }
            : undefined;
        let renderedBytes: Uint8Array;
        if (format === "svg") {
            const svgText = (yield* renderDisplayListToSvgSteps(displayList, {
                dpiX: effDpiX,
                dpiY: effDpiY,
                useCropBox,
                cropRect,
                hideAnnotations,
                transparent,
            }));
            renderedBytes = new TextEncoder().encode(svgText);
        }
        else {
            const bitmap = (yield* renderDisplayListToBitmapSteps(displayList, {
                dpiX: effDpiX,
                dpiY: effDpiY,
                useCropBox,
                cropRect,
                hideAnnotations,
                transparent,
                antialiasText,
                antialiasVector,
                thinLineMode,
            }));
            options.onAllocateBytes?.(bitmap.width * bitmap.height * 4);
            if (colorMode !== "rgb" && (format === "png" || format === "tif" || format === "jpg")) {
                for (let px = 0; px < bitmap.data.length; px += 4) {
                    if (++cooperativeWork % 65536 === 0)
                        yield;
                    const r = bitmap.data[px]!;
                    const g = bitmap.data[px + 1]!;
                    const b = bitmap.data[px + 2]!;
                    const lum = Math.round(0.299 * r + 0.587 * g + 0.114 * b);
                    const v = colorMode === "mono" ? (lum < 128 ? 0 : 255) : lum;
                    bitmap.data[px] = v;
                    bitmap.data[px + 1] = v;
                    bitmap.data[px + 2] = v;
                }
            }
            if (format === "png")
                renderedBytes = (yield* encodePngSteps(bitmap));
            else if (format === "tif")
                renderedBytes = (yield* encodeTiffSteps(bitmap, effDpiX, tiffCompression));
            else if (format === "jpg")
                renderedBytes = (yield* encodeJpegSteps(bitmap, jpegQuality));
            else if (format === "pgm")
                renderedBytes = (yield* encodePgmSteps(bitmap));
            else if (format === "pbm")
                renderedBytes = (yield* encodePbmSteps(bitmap));
            else
                renderedBytes = (yield* encodePpmSteps(bitmap));
            if (typeof (bitmap.data.buffer as ArrayBuffer & { transfer?: (n: number) => ArrayBuffer }).transfer === "function" && bitmap.data.byteOffset === 0 && bitmap.data.byteLength === bitmap.data.buffer.byteLength) {
                try { (bitmap.data.buffer as ArrayBuffer & { transfer: (n: number) => ArrayBuffer }).transfer(0); } catch { /* Detachment is best effort for host buffers. */ }
            }
        }
        options.onAllocateBytes?.(renderedBytes.byteLength);
        if (!prefix || prefix === "-") {
            outChunks.push(renderedBytes);
            if (progress && !quiet) {
                progressLines.push(`${p} ${endPage} -`);
            }
        }
        else {
            const effectivePageNo = setPageNo !== undefined ? setPageNo + (p - firstPage) : p;
            const pageSuffix = String(effectivePageNo).padStart(Math.max(padWidth, String(effectivePageNo).length), "0");
            const fileName = singleFile && !forceNum
                ? `${prefix}.${ext}`
                : `${prefix}${sep}${pageSuffix}.${ext}`;
            files.set(fileName, renderedBytes);
            if (progress && !quiet) {
                progressLines.push(`${p} ${endPage} ${fileName}`);
            }
        }
        if (singleFile)
            break;
        if (typeof (globalThis as { gc?: () => void }).gc === "function") {
            try { const gc = (globalThis as { gc?: () => void }).gc!; gc(); gc(); } catch { /* Optional host GC hints must not interrupt page conversion. */ }
        }
    }
    const stderrText = progressLines.length > 0 ? progressLines.join("\n") + "\n" : "";
    if (outChunks.length > 0) {
        const totalLen = outChunks.reduce((s, c) => s + c.byteLength, 0);
        const merged = new Uint8Array(totalLen);
        let off = 0;
        for (const c of outChunks) {
            if (++cooperativeWork % 64 === 0)
                yield;
            merged.set(c, off);
            off += c.byteLength;
        }
        return { exitCode: 0, stdout: "", stderr: stderrText, stdoutBytes: merged };
    }
    return { exitCode: 0, stdout: "", stderr: stderrText };
}
export async function runPdftoppmCli(argv: readonly string[], files: Map<string, Uint8Array>, options: {
    readonly signal?: AbortSignal;
    readonly onAllocateBytes?: (bytes: number) => void;
} = {}): Promise<PdftoppmCliResult> {
    return drainSteps(runPdftoppmCliSteps(argv, files, options), options.signal);
}
export function runPdftoppmCliSync(argv: readonly string[], files: Map<string, Uint8Array>, options: {
    readonly signal?: AbortSignal;
    readonly onAllocateBytes?: (bytes: number) => void;
} = {}): PdftoppmCliResult {
    const steps = runPdftoppmCliSteps(argv, files, options);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}



async function executePdftoppm(context: CommandContext): Promise<{ exitCode: number }> {
  let cooperativeWork = 63;
  const invocation = createOutputOperation(context, { write: async () => {} });
  try {
    const carrier = getCommandArguments(context);
    const argv = [...carrier.args];
    const vfsFiles = new Map<string, Uint8Array>();
    let accountedBytes = 0;
    const chargeBytes = (delta: number) => {
      if (delta > 0) {
        accountedBytes += delta;
        context.inputBudget?.check(accountedBytes);
      }
    };

    // Parse before acquiring input: help, version and usage errors need no PDF.
    const needsInput = (await runPdftoppmCli(argv, new Map([["-", new Uint8Array()]]), { signal: invocation.signal })).exitCode === 1;
    const positionals = needsInput ? extractPdftoppmPositionals(argv) : [];
    const readStdin = needsInput && (positionals.length === 0 || positionals[0] === "-");
    if (readStdin) {
      const chunks: Uint8Array[] = [];
      let total = 0;
      for await (const chunk of readBytes(context.stdin, invocation.signal)) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
        chunks.push(chunk);
        total += chunk.byteLength;
        chargeBytes(chunk.byteLength);
      }
      const buf = new Uint8Array(total);
      let off = 0;
      for (const c of chunks) {
    if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
        buf.set(c, off);
        off += c.byteLength;
      }
      vfsFiles.set("-", buf);
    }

    for (const token of positionals.slice(0, 1)) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
      if (token === "-") continue;
      try {
        const bytes = await context.fs.readFile(resolvePath(context.cwd, token), { signal: invocation.signal });
        chargeBytes(bytes.byteLength);
        vfsFiles.set(token, bytes);
      } catch {
        // Output prefix or non-existing file
      }
    }

    context.inputBudget?.check(0);
    const existingSnap = new Map(vfsFiles);
    const res = await runPdftoppmCli(argv, vfsFiles, { signal: invocation.signal });
    if (res.stderr) {
      await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
    }
    if (res.stdoutBytes) {
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, res.stdoutBytes, invocation.signal);
    } else if (res.stdout) {
      const stdout = invocation.child(context.stdout);
      await writeBytes(stdout.output, new TextEncoder().encode(res.stdout), invocation.signal);
    }
    for (const [key, val] of vfsFiles.entries()) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
      if (key !== "-" && existingSnap.get(key) !== val) {
        const abs = resolvePath(context.cwd, key);
        try {
          await writeFileOutput(context, val, data => context.fs.writeFile(abs, data, { signal: invocation.signal }));
        } catch (error) {
          invocation.signal.throwIfAborted();
          if (!(error instanceof Error) || !("code" in error)) throw error;
          await writeBytes(context.stderr, new TextEncoder().encode(`Could not write image to ${key}; exiting\n`), invocation.signal);
          return { exitCode: 1 };
        }
      }
    }
    return { exitCode: res.exitCode };
  } finally {
    await invocation.close();
  }
}

export function createPdftoppmCommand(options: PdftoppmCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "pdftoppm",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Render PDF pages to PNG, PPM, PGM, PBM, or SVG via @poe-code/pdf-ast",
    async execute(context: CommandContext) {
      const parsed = await drainSteps(parsePdftoppmArgsSteps(getCommandArguments(context).args, true), context.signal);
      if ("inputPath" in parsed && parsed.format !== "svg") {
        const invocation = createOutputOperation(context, { write: async () => {} });
        try { return await executeRetainedRaster(context, parsed, invocation.child(context.stdout).output, invocation.signal, maxInputBytes); }
        finally { await invocation.close(); }
      }
      return new InputByteBudget(maxInputBytes).run(context, executePdftoppm);
    },
  });
}

export const pdftoppmCommand: CommandDefinition = createPdftoppmCommand();

function extractPdftocairoPositionals(argv: readonly string[]): string[] {
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
        pos.push(...argv.slice(i + 1));
        break;
    }
    if (CAIRO_VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") {
      pos.push(arg);
    }
  }
  return pos;
}

function* runPdftocairoCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, options: {
    readonly signal?: AbortSignal;
    readonly onAllocateBytes?: (bytes: number) => void;
} = {}): Generator<void, PdftoppmCliResult, void> {
    const parsed = yield* parsePdftocairoArgsSteps(argv, files.has("-"));
    if (!("inputPath" in parsed)) return parsed;
    const { format, grayMode, monoMode, quiet, firstPage, lastPage, oddOnly, evenOnly, cropX, cropY, cropW, cropH, hasCrop, paperW, paperH, origPageSizes, password, forwardedArgs, positionals, inputPath } = parsed;
    let cooperativeWork = 63;
    const inputStem = inputPath.toLowerCase().endsWith(".pdf") ? inputPath.slice(0, -4) : inputPath;
    if (format === "svg") {
        const rawOut = positionals[1] ?? (inputPath === "-" ? "-" : `${inputStem}.svg`);
        const rootForSvg = rawOut.toLowerCase().endsWith(".svg") ? rawOut.slice(0, -4) : rawOut;
        return (yield* runPdftoppmCliSteps(["-svg", "-singlefile", ...forwardedArgs, "--", inputPath, rootForSvg], files, options));
    }
    if (format === "pdf" || format === "ps" || format === "eps") {
        const pdfBytes = files.get(inputPath);
        if (!pdfBytes) {
            return { exitCode: 1, stdout: "", stderr: quiet ? "" : `I/O Error: Couldn't open file '${inputPath}'\n` };
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
        const selectedIndices: number[] = [];
        for (let p = firstPage; p <= endPage; p++) {
            yield;
            if (oddOnly && p % 2 === 0)
                continue;
            if (evenOnly && p % 2 !== 0)
                continue;
            selectedIndices.push(p - 1);
        }
        const rawOut = positionals[1] ?? (inputPath === "-" ? "-" : `${inputStem}.${format}`);
        const finalOut = rawOut === "-" || rawOut.toLowerCase().endsWith(`.${format}`) ? rawOut : `${rawOut}.${format}`;
        if (format === "pdf") {
            const outDoc = PdfDocument.create();
            const srcMeta = doc.getMetadata();
            if (srcMeta.title)
                outDoc.setTitle(srcMeta.title);
            if (srcMeta.author)
                outDoc.setAuthor(srcMeta.author);
            if (srcMeta.subject)
                outDoc.setSubject(srcMeta.subject);
            if (srcMeta.keywords)
                outDoc.setKeywords(srcMeta.keywords);
            if (srcMeta.creator)
                outDoc.setCreator(srcMeta.creator);
            if (srcMeta.producer)
                outDoc.setProducer(srcMeta.producer);
            const hasPaper = !origPageSizes && paperW > 0 && paperH > 0;
            for (const idx of selectedIndices) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                const [copied] = outDoc.copyPagesFrom(doc, [idx]);
                if (copied && (hasCrop || hasPaper)) {
                    const origSize = copied.getSize();
                    const effW = hasPaper ? paperW : cropW > 0 ? cropW : Math.max(1, origSize.width - cropX);
                    const effH = hasPaper ? paperH : cropH > 0 ? cropH : Math.max(1, origSize.height - cropY);
                    dictSet(copied.pageDict, "MediaBox", cosArray([cosNumber(0), cosNumber(0), cosNumber(effW), cosNumber(effH)]));
                    dictSet(copied.pageDict, "CropBox", cosArray([cosNumber(0), cosNumber(0), cosNumber(effW), cosNumber(effH)]));
                }
            }
            const outBytes = outDoc.save();
            if (finalOut === "-") {
                return { exitCode: 0, stdout: "", stderr: "", stdoutBytes: outBytes };
            }
            files.set(finalOut, outBytes);
            return { exitCode: 0, stdout: "", stderr: "" };
        }
        const firstIdx = selectedIndices[0] ?? 0;
        const firstSize = doc.getPage(firstIdx).getSize();
        const bboxW = hasCrop && cropW > 0 ? cropW : Math.round(firstSize.width);
        const bboxH = hasCrop && cropH > 0 ? cropH : Math.round(firstSize.height);
        const psLines: string[] = [
            format === "eps" ? "%!PS-Adobe-3.0 EPSF-3.0" : "%!PS-Adobe-3.0",
            "%%Creator: @poe-code/pdf-ast (pdftocairo 24.08.0)",
            `%%BoundingBox: 0 0 ${bboxW} ${bboxH}`,
            `%%Pages: ${selectedIndices.length}`,
            "%%EndComments",
        ];
        for (let s = 0; s < selectedIndices.length; s++) {
            if (++cooperativeWork % 64 === 0)
                yield;
            const page = doc.getPage(selectedIndices[s]!);
            psLines.push(`%%Page: ${s + 1} ${s + 1}`);
            psLines.push("/Helvetica findfont 12 scalefont setfont");
            const extracted = page.extractPage();
            for (const block of extracted.blocks) {
                if (++cooperativeWork % 64 === 0)
                    yield;
                for (const line of block.lines) {
                    if (++cooperativeWork % 64 === 0)
                        yield;
                    const escaped = line.text
                        .replaceAll("\\", "\\\\")
                        .replaceAll("(", "\\(")
                        .replaceAll(")", "\\)");
                    psLines.push(`${Math.round(line.bbox[0])} ${Math.round(line.bbox[1])} moveto (${escaped}) show`);
                }
            }
            psLines.push("showpage");
        }
        psLines.push("%%Trailer", "%%EOF", "");
        const psBytes = new TextEncoder().encode(psLines.join("\n"));
        if (finalOut === "-") {
            return { exitCode: 0, stdout: "", stderr: "", stdoutBytes: psBytes };
        }
        files.set(finalOut, psBytes);
        return { exitCode: 0, stdout: "", stderr: "" };
    }
    const snapBefore = new Map(files);
    const rasterPositionals = positionals.length === 1 && inputPath !== "-" ? [inputPath, inputStem] : positionals;
    const res = (yield* runPdftoppmCliSteps([...forwardedArgs, "--", ...rasterPositionals], files, options));
    if (res.exitCode !== 0 || (!grayMode && !monoMode)) {
        return res;
    }
    const convertRgbaInPlace = (data: Uint8Array) => {
        for (let p = 0; p < data.length; p += 4) {
            const lum = Math.round(0.299 * data[p]! + 0.587 * data[p + 1]! + 0.114 * data[p + 2]!);
            const v = monoMode ? (lum >= 128 ? 255 : 0) : lum;
            data[p] = v;
            data[p + 1] = v;
            data[p + 2] = v;
        }
    };
    for (const [k, v] of files.entries()) {
        if (++cooperativeWork % 64 === 0)
            yield;
        if (snapBefore.get(k) !== v && k.endsWith(".png")) {
            const decoded = (yield* decodePngSteps(v));
            convertRgbaInPlace(decoded.data);
            files.set(k, (yield* encodePngSteps(decoded)));
        }
    }
    return res;
}
export async function runPdftocairoCli(argv: readonly string[], files: Map<string, Uint8Array>, options: {
    readonly signal?: AbortSignal;
    readonly onAllocateBytes?: (bytes: number) => void;
} = {}): Promise<PdftoppmCliResult> {
    return drainSteps(runPdftocairoCliSteps(argv, files, options), options.signal);
}
export function runPdftocairoCliSync(argv: readonly string[], files: Map<string, Uint8Array>, options: {
    readonly signal?: AbortSignal;
    readonly onAllocateBytes?: (bytes: number) => void;
} = {}): PdftoppmCliResult {
    const steps = runPdftocairoCliSteps(argv, files, options);
    let next = steps.next();
    while (!next.done) {
        next = steps.next();
    }
    return next.value;
}

export function createPdftocairoCommand(options: PdftoppmCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "pdftocairo",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Render PDF pages to PNG, JPEG, TIFF, PDF, PS, EPS, or SVG via @poe-code/pdf-ast",
    async execute(context: CommandContext) {
      const parsed = await drainSteps(parsePdftocairoArgsSteps(getCommandArguments(context).args, true), context.signal);
      if ("inputPath" in parsed && (parsed.format === "png" || parsed.format === "jpg" || parsed.format === "tif")) {
        const stem = parsed.inputPath.toLowerCase().endsWith(".pdf") ? parsed.inputPath.slice(0, -4) : parsed.inputPath;
        const positionals = parsed.positionals.length === 1 && parsed.inputPath !== "-" ? [parsed.inputPath, stem] : parsed.positionals;
        let plan = await drainSteps(parsePdftoppmArgsSteps([...parsed.forwardedArgs, "--", ...positionals], true), context.signal);
        const invocation = createOutputOperation(context, { write: async () => {} });
        try {
          if (!("inputPath" in plan)) {
            if (plan.stdout) await writeBytes(invocation.child(context.stdout).output, new TextEncoder().encode(plan.stdout), invocation.signal);
            if (plan.stderr) await writeBytes(context.stderr, new TextEncoder().encode(plan.stderr), invocation.signal);
            return { exitCode: plan.exitCode };
          }
          // Preserve Cairo's existing PNG-file-only color conversion.
          if (plan.format === "png" && plan.positionals[1] && plan.positionals[1] !== "-" && (parsed.grayMode || parsed.monoMode)) {
            plan = { ...plan, colorMode: parsed.monoMode ? "mono" : "gray" };
          }
          return await executeRetainedRaster(context, plan, invocation.child(context.stdout).output, invocation.signal, maxInputBytes,
            name => ({ exitCode: 2, stderr: `Error opening output file ${name}\n` }));
        } finally { await invocation.close(); }
      }
      return new InputByteBudget(maxInputBytes).run(context, async context => {
  let cooperativeWork = 63;
        const invocation = createOutputOperation(context, { write: async () => {} });
try {
        const carrier = getCommandArguments(context);
        const argv = [...carrier.args];
        const vfsFiles = new Map<string, Uint8Array>();
        let accountedBytes = 0;
        const chargeBytes = (delta: number) => {
          if (delta > 0) {
            accountedBytes += delta;
            context.inputBudget?.check(accountedBytes);
          }
        };
        let informational = false;
        for (let i = 0; i < argv.length; i++) {
          const arg = argv[i]!;
          if (arg === "--") break;
          if (CAIRO_VALUE_FLAGS.has(arg)) { i++; continue; }
          if (["-h", "-help", "--help", "-?", "-v", "--version"].includes(arg)) { informational = true; break; }
        }
        const positionals = informational ? [] : extractPdftocairoPositionals(argv);
        if (!informational && (positionals.length === 0 || positionals[0] === "-")) {
          const chunks: Uint8Array[] = [];
          let total = 0;
          for await (const chunk of readBytes(context.stdin, invocation.signal)) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
            chunks.push(chunk);
            total += chunk.byteLength;
            chargeBytes(chunk.byteLength);
          }
          if (total > 0) {
            const buf = new Uint8Array(total);
            let off = 0;
            for (const c of chunks) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
              buf.set(c, off);
              off += c.byteLength;
            }
            vfsFiles.set("-", buf);
          }
        }
        for (const token of positionals.slice(0, 1)) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
          if (token === "-") continue;
          try {
            const bytes = await context.fs.readFile(resolvePath(context.cwd, token), { signal: invocation.signal });
            chargeBytes(bytes.byteLength);
            vfsFiles.set(token, bytes);
          } catch {
            // Output file or prefix
          }
        }
        context.inputBudget?.check(0);
    const existingSnap = new Map(vfsFiles);
        const res = await runPdftocairoCli(argv, vfsFiles, { signal: invocation.signal });
        if (res.stderr) {
          await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
        }
        if (res.stdoutBytes) {
          const stdout = invocation.child(context.stdout);
          await writeBytes(stdout.output, res.stdoutBytes, invocation.signal);
        } else if (res.stdout) {
          const stdout = invocation.child(context.stdout);
          await writeBytes(stdout.output, new TextEncoder().encode(res.stdout), invocation.signal);
        }
        for (const [key, val] of vfsFiles.entries()) {
      if (++cooperativeWork % 64 === 0) await yieldTurn(context.signal);
          if (key !== "-" && existingSnap.get(key) !== val) {
            const abs = resolvePath(context.cwd, key);
            try {
              await writeFileOutput(context, val, data => context.fs.writeFile(abs, data, { signal: invocation.signal }));
            } catch (error) {
              invocation.signal.throwIfAborted();
              if (!(error instanceof Error) || !("code" in error)) throw error;
              await writeBytes(context.stderr, new TextEncoder().encode(`Error opening output file ${key}\n`), invocation.signal);
              return { exitCode: 2 };
            }
          }
        }
        return { exitCode: res.exitCode };
      } finally {
        await invocation.close();
      }
      });
    },
  });
}

export const pdftocairoCommand: CommandDefinition = createPdftocairoCommand();

export function pdftoppmPlugin(options: PdftoppmCommandsOptions = {}): VirtualShellPlugin {
  const commands = createPdftoppmCommands(options);
  const replace = options.replace ?? false;
  return {
    name: "pdftoppm",
    setup(host) {
      for (const command of commands) host.commands.register(command, { replace });
    }
  };
}

export const pdftoppmCommands = pdftoppmPlugin;

export type PdftoppmCommandsOptions = PdftoppmCommandOptions;

export function createPdftoppmCommands(options: PdftoppmCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createPdftoppmCommand(options), createPdftocairoCommand(options)]);
}
