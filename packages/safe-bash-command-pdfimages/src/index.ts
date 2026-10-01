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
import { PdfDocument, encodePbmSteps, encodePngSteps, encodePpmSteps, encodeTiffSteps, extractDocumentImagesSteps } from "@poe-code/pdf-ast";

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

function extractPdfimagesPositionals(argv: readonly string[]): string[] {
  const pos: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "--") {
      pos.push(...argv.slice(i + 1));
      break;
    }
    if (PDFIMAGES_VALUE_FLAGS.has(arg)) {
      i++;
      continue;
    }
    if (!arg.startsWith("-") || arg === "-") {
      pos.push(arg);
    }
  }
  return pos;
}

function* runPdfimagesCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, options: {
    readonly signal?: AbortSignal;
    readonly onAllocateBytes?: (bytes: number) => void;
} = {}): Generator<void, PdfimagesCliResult, void> {
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
                stdout: "Usage: pdfimages [options] <PDF-file> [<image-root>]\n  -list / -png / -j / -all / -f <int> / -l <int> / -p\n  -min-width <int> / -min-height <int> : ignore smaller images\n",
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
    const inputPath = positionals[0] ?? (files.has("-") ? "-" : undefined);
    if (!inputPath || positionals.length !== (listOnly ? 1 : 2)) {
        return { exitCode: 99, stdout: "", stderr: "Usage: pdfimages [options] <PDF-file> [<image-root>]\n" };
    }
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
        const objField = img.inline || !img.objectId
            ? "  [inline]"
            : `${String(img.objectId.objNum).padStart(6)} ${String(img.objectId.genNum).padStart(2)}`;
        const sizeStr = formatPopplerSize(img.byteLength).padStart(5);
        const ratioStr = formatPopplerRatio(img.byteLength, img.width, img.height, img.components, img.bitsPerComponent).padStart(5);
        const interpStr = (img.interpolate ? "yes" : "no").padStart(6);
        const colorCol = (img.colorSpaceLabel ?? img.colorSpace).padEnd(5);
        listLines.push(`${String(img.pageNumber).padStart(4)} ${String(idx).padStart(5)} ${img.type.padEnd(6)} ${String(img.width).padStart(5)} ${String(img.height).padStart(6)} ${colorCol} ${String(img.components).padStart(4)} ${String(img.bitsPerComponent).padStart(3)}  ${img.encoding.padEnd(5)} ${interpStr} ${objField} ${String(img.xPpi).padStart(5)} ${String(img.yPpi).padStart(5)} ${sizeStr} ${ratioStr}`);
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

async function executePdfimages(context: CommandContext): Promise<{ exitCode: number }> {
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
    const needsInput = (await runPdfimagesCli(argv, new Map(), { signal: invocation.signal })).exitCode === 1;
    const positionals = needsInput ? extractPdfimagesPositionals(argv) : [];
    if (needsInput && (positionals.length === 0 || positionals[0] === "-")) {
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
        // Non-existing output file or prefix
      }
    }

    context.inputBudget?.check(0);
    const existingSnap = new Map(vfsFiles);
    const res = await runPdfimagesCli(argv, vfsFiles, { onAllocateBytes: chargeBytes, signal: invocation.signal });
    if (res.stderr) {
      await writeBytes(context.stderr, new TextEncoder().encode(res.stderr), invocation.signal);
    }
    if (res.stdout) {
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
          await writeBytes(context.stderr, new TextEncoder().encode(`I/O Error: Couldn't open image file '${key}'\n`), invocation.signal);
          return { exitCode: 2 };
        }
      }
    }
    return { exitCode: res.exitCode };
  } finally {
    await invocation.close();
  }
}

export function createPdfimagesCommand(options: PdfimagesCommandOptions = {}): CommandDefinition {
  const maxInputBytes = InputByteBudget.limit(options.limits?.maxInputBytes);
  return Object.freeze({
    name: "pdfimages",
    runtimeIdentity: commandRuntimeIdentity,
    description: "List and extract embedded images from PDF pages via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return new InputByteBudget(maxInputBytes).run(context, executePdfimages);
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


