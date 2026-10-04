import { parsePdfseparateArgs, parsePdfseparateSpec } from "./parse.js";
import { executeRetainedSeparate } from "./retained.js";
import { drainCooperativeSteps as drainSteps } from "safe-bash-contracts/yield";
import { writeBytes } from "safe-bash-contracts/io";
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

function copyDocumentMetadata(srcDoc: PdfDocument, dstDoc: PdfDocument): void {
  const meta = srcDoc.getMetadata();
  if (meta.title) dstDoc.setTitle(meta.title);
  if (meta.author) dstDoc.setAuthor(meta.author);
  if (meta.subject) dstDoc.setSubject(meta.subject);
  if (meta.keywords) dstDoc.setKeywords(meta.keywords);
  if (meta.creator) dstDoc.setCreator(meta.creator);
  if (meta.producer) dstDoc.setProducer(meta.producer);
}


function* runPdfseparateCliSteps(argv: readonly string[], files: Map<string, Uint8Array>, signal?: AbortSignal, options: PdfseparateCommandsOptions = {}): Generator<void, {
    exitCode: number;
    stdout: string;
    stderr: string;
}, void> {
    const limits = resolveLimits(options);
    let inputBytes = 0;
    let outputBytes = 0;
    yield;
    const plan = parsePdfseparateArgs(argv);
    if ("exitCode" in plan) return plan;
    const { firstPage, lastPage, srcPath, pattern } = plan;
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
    async execute(context: CommandContext) {
      const operation = createOutputOperation(context, { write: async () => {} });
      let failed = false;
      try {
        const plan = parsePdfseparateArgs(getCommandArguments(context).args);
        if ("exitCode" in plan) {
          if (plan.stderr) await writeBytes(context.stderr, new TextEncoder().encode(plan.stderr), operation.signal);
          return { exitCode: plan.exitCode };
        }
        return await executeRetainedSeparate(context, plan, limits, operation.signal);
      } catch (error) { failed = true; throw error; }
      finally { await operation.close().catch(error => { if (!failed) throw error; }); }
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
