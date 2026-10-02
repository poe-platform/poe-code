import { resolvePath } from "safe-bash-contracts/path";
import { drainCooperativeSteps as drainSteps } from "safe-bash-contracts/yield";
import { InputByteBudget, writeBytes } from "safe-bash-contracts/io";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { commandRuntimeIdentity, getCommandArguments, type CommandContext, type CommandDefinition } from "safe-bash-contracts/command";
import { createOutputOperation } from "safe-bash-contracts/output";
import type { VirtualShellPlugin } from "safe-bash-contracts/plugin";
import { PdfDocument, PdfError } from "@poe-code/pdf-ast";

export interface PdfseparateLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxPages: number;
  readonly maxObjects: number;
}
export interface PdfseparateCommandsOptions {
  readonly limits?: Partial<PdfseparateLimits>;
  readonly replace?: boolean;
}
export type PdfseparateCommandOptions = PdfseparateCommandsOptions;
function resolveLimits(options: PdfseparateCommandsOptions): PdfseparateLimits {
  const limits = { maxInputBytes: 67108864, maxOutputBytes: 134217728, maxPages: 10000, maxObjects: 100000, ...options.limits };
  for (const [name, value] of Object.entries(limits)) {
    if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`Invalid ${name} limit`);
  }
  return limits;
}
const usage = "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n  -f <int> / -l <int>\n";

function copyDocumentMetadata(srcDoc: PdfDocument, dstDoc: PdfDocument): void {
  const meta = srcDoc.getMetadata();
  if (meta.title) dstDoc.setTitle(meta.title);
  if (meta.author) dstDoc.setAuthor(meta.author);
  if (meta.subject) dstDoc.setSubject(meta.subject);
  if (meta.keywords) dstDoc.setKeywords(meta.keywords);
  if (meta.creator) dstDoc.setCreator(meta.creator);
  if (meta.producer) dstDoc.setProducer(meta.producer);
}

function parsePdfseparateSpec(pattern: string): {
  readonly hasPageSpec: boolean;
  format(pageNumber: number): string;
} {
  let hasPageSpec = false;
  for (let i = 0; i < pattern.length; i++) {
    if (pattern[i] !== "%") continue;
    if (pattern[i + 1] === "%") {
      i++;
      continue;
    }
    let j = i + 1;
    while (j < pattern.length && pattern[j]! >= "0" && pattern[j]! <= "9") j++;
    if (pattern[j] === "d") {
      hasPageSpec = true;
      break;
    }
  }
  return {
    hasPageSpec,
    format(pageNumber: number): string {
      let out = "";
      let replaced = false;
      for (let i = 0; i < pattern.length; i++) {
        if (pattern[i] !== "%") {
          out += pattern[i]!;
          continue;
        }
        if (pattern[i + 1] === "%") {
          out += "%";
          i++;
          continue;
        }
        if (!replaced) {
          let j = i + 1;
          let digits = "";
          while (j < pattern.length && pattern[j]! >= "0" && pattern[j]! <= "9") {
            digits += pattern[j]!;
            j++;
          }
          if (pattern[j] === "d") {
            const width = digits.length > 0 ? Number.parseInt(digits, 10) || 0 : 0;
            if (!Number.isSafeInteger(width) || width > 4096) throw new RangeError("Filename width limit exceeded");
            const padChar = digits.startsWith("0") ? "0" : " ";
            out += width > 0 ? String(pageNumber).padStart(width, padChar) : String(pageNumber);
            replaced = true;
            i = j;
            continue;
          }
        }
        out += "%";
      }
      return out;
    },
  };
}

function* runPdfseparateCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, signal?: AbortSignal, options: PdfseparateCommandsOptions = {}): Generator<void, {
    exitCode: number;
    stdout: string;
    stderr: string;
}, void> {
    const limits = resolveLimits(options);
    let inputBytes = 0;
    let outputBytes = 0;
    let cooperativeWork = 63;
    let firstPage = 1;
    let lastPage = 0;
    const positionals: string[] = [];
    for (let i = 0; i < argv.length; i++) {
        if (++cooperativeWork % 64 === 0)
            yield;
        const arg = argv[i]!;
        if (arg === "-v" || arg === "--version") return { exitCode: 0, stdout: "", stderr: "pdfseparate version 24.08.0\n" };
        if (["-h", "-help", "--help", "-?"].includes(arg)) return { exitCode: 0, stdout: "", stderr: usage };
        if (arg === "--") { positionals.push(...argv.slice(i + 1)); break; }
        if (arg === "-f" || arg === "-l") {
          const token = argv[++i];
          const digits = token?.startsWith("-") ? token.slice(1) : token;
          if (!digits || [...digits].some(c => c < "0" || c > "9") || !Number.isSafeInteger(Number(token))) return { exitCode: 99, stdout: "", stderr: usage };
          if (arg === "-f") firstPage = Math.max(1, Number(token));
          else lastPage = Math.max(0, Number(token));
          continue;
        }
        if (arg.startsWith("-")) return { exitCode: 99, stdout: "", stderr: usage };
        positionals.push(arg);
    }
    if (positionals.length !== 2) {
        return {
            exitCode: 99,
            stdout: "",
            stderr: "Usage: pdfseparate [options] <PDF-sourcefile> <PDF-pattern-destfile>\n"
        };
    }
    const srcPath = positionals[0]!;
    const pattern = positionals[1]!;
    const srcBytes = files.get(srcPath);
    if (!srcBytes) {
        return { exitCode: 99, stdout: "", stderr: `I/O Error: Couldn't open file '${srcPath}': No such file or directory.\nSyntax Error: Could not extract page(s) from damaged file ('${srcPath}')\n` };
  }
  inputBytes += srcBytes.byteLength;
    if (inputBytes > limits.maxInputBytes) throw new RangeError("Input byte limit exceeded");
    let srcDoc: PdfDocument;
  try {
    srcDoc = (yield* PdfDocument.loadSteps(srcBytes, { maxObjects: limits.maxObjects, maxDecompressedBytes: limits.maxInputBytes, maxRecursionDepth: 128 }));
  } catch (err) {
    signal?.throwIfAborted();
      if (err instanceof PdfError && err.code === "E_LIMIT") throw err;
      return { exitCode: 99, stdout: "", stderr: `${err instanceof PdfError && (err.code === "E_PASSWORD" || err.message === "Invalid PDF password") ? "Command Line Error: Incorrect password\n" : ""}Syntax Error: Could not extract page(s) from damaged file ('${srcPath}')\n` };
    }
    if (srcDoc.pageCount > limits.maxPages) throw new RangeError("Page limit exceeded");
    const endPage = lastPage > 0 ? Math.min(srcDoc.pageCount, lastPage) : srcDoc.pageCount;
    if (firstPage > srcDoc.pageCount ||
        (lastPage > 0 && (lastPage > srcDoc.pageCount || firstPage > lastPage))) {
        return {
            exitCode: 99,
            stdout: "",
            stderr: `Command Line Error: Wrong page range given: the first page (${firstPage}) can not be after the last page (${endPage}).\n`
        };
    }
    const spec = parsePdfseparateSpec(pattern);
    const hasPageSpec = spec.hasPageSpec;
    if (endPage > firstPage && !hasPageSpec) {
        return {
            exitCode: 99,
            stdout: "",
            stderr: `Error: '${pattern}' must contain '%d' if more than one page should be extracted\n`
        };
    }
    for (let p = firstPage; p <= endPage; p++) {
        yield;
        const singleDoc = PdfDocument.create();
        copyDocumentMetadata(srcDoc, singleDoc);
        yield* singleDoc.copyPagesFromSteps(srcDoc, [p - 1]);
        const outPath = spec.format(p);
        const bytes = yield* singleDoc.saveSteps();
    outputBytes += bytes.byteLength;
    if (outputBytes > limits.maxOutputBytes) throw new RangeError("Output byte limit exceeded");
    files.set(outPath, bytes);
    }
    return { exitCode: 0, stdout: "", stderr: "" };
}
export async function runPdfseparateCli(argv: readonly string[], files: Map<string, Uint8Array>, signal?: AbortSignal, options: PdfseparateCommandsOptions = {}): Promise<{
    exitCode: number;
    stdout: string;
    stderr: string;
}> {
    return drainSteps(runPdfseparateCliSteps(argv, files, signal, options), signal);
}

export function createPdfseparateCommand(options: PdfseparateCommandsOptions = {}): CommandDefinition {
  const limits = resolveLimits(options);
  return Object.freeze({
    name: "pdfseparate",
    runtimeIdentity: commandRuntimeIdentity,
    description: "Split PDF pages into individual PDF files via @poe-code/pdf-ast",
    execute(context: CommandContext) {
      return new InputByteBudget(limits.maxInputBytes).run(context, async context => {
        const operation = createOutputOperation(context, { write: async () => {} });
        try {
          const argv = [...getCommandArguments(context).args];
          const paths: string[] = [];
          let informational = false;
          for (let i = 0; i < argv.length; i++) {
            const arg = argv[i]!;
            if (arg === "--") { paths.push(...argv.slice(i + 1)); break; }
            if (arg === "-f" || arg === "-l") { i++; continue; }
            if (["-h", "-help", "--help", "-?", "-v", "--version"].includes(arg)) informational = true;
            if (!arg.startsWith("-")) paths.push(arg);
          }
          const files = new Map<string, Uint8Array>();
          let inputBytes = 0;
          if (!informational) for (const path of new Set(paths.slice(0, 1))) {
            let bytes: Uint8Array;
            try { bytes = await context.fs.readFile(resolvePath(context.cwd, path), { signal: operation.signal }); }
            catch (error) {
              operation.signal.throwIfAborted();
              if (!(error instanceof Error) || !("code" in error)) throw error;
              continue;
            }
            inputBytes += bytes.byteLength;
            context.inputBudget?.check(inputBytes);
            if (inputBytes > limits.maxInputBytes) throw new RangeError("Input byte limit exceeded");
            files.set(path, bytes);
          }
          const before = new Map(files);
          const result = await runPdfseparateCli(argv, files, operation.signal, { limits });
          if (result.stderr) await writeBytes(context.stderr, new TextEncoder().encode(result.stderr), operation.signal);
          if (result.stdout) await writeBytes(operation.child(context.stdout).output, new TextEncoder().encode(result.stdout), operation.signal);
          if (result.exitCode !== 0) return { exitCode: result.exitCode };
          for (const [path, bytes] of files) {
            if (before.get(path) === bytes) continue;
            try {
              await writeFileOutput(context, bytes, data => context.fs.writeFile(resolvePath(context.cwd, path), data, { signal: operation.signal }));
            } catch (error) {
              operation.signal.throwIfAborted();
              if (!(error instanceof Error) || !("code" in error)) throw error;
              await writeBytes(context.stderr, new TextEncoder().encode(`I/O Error: Couldn't open file '${path}'\n`), operation.signal);
              return { exitCode: 99 };
            }
          }
          return { exitCode: 0 };
        } finally { await operation.close(); }
      });
    }
  });
}
export const pdfseparateCommand = createPdfseparateCommand();
export function createPdfseparateCommands(options: PdfseparateCommandsOptions = {}): readonly CommandDefinition[] {
  return Object.freeze([createPdfseparateCommand(options)]);
}
export function pdfseparateCommands(options: PdfseparateCommandsOptions = {}): VirtualShellPlugin {
  const commands = createPdfseparateCommands(options);
  return { name: "pdfseparate", setup(host) {
    for (const command of commands) host.commands.register(command, { replace: options.replace ?? false });
  } };
}
