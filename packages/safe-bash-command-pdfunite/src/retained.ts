import { PdfError, PdfFileSource, PdfRetainedDocument, copyRetainedPagesChunks, dictGet } from "@poe-code/pdf-ast";
import type { CommandContext } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { writeBytes } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import type { PdfuniteLimits } from "./index.js";
export const pdfuniteUsage = "Usage: pdfunite [options] <PDF-sourcefile-1>..<PDF-sourcefile-n> <PDF-destfile>\n";
class MergeInputError extends Error {}

export async function executeRetainedUnite(context: CommandContext, argv: readonly string[], limits: PdfuniteLimits, signal: AbortSignal): Promise<{ exitCode: number }> {
  const diagnostic = async (message: string, exitCode = 255) => { await writeBytes(context.stderr, new TextEncoder().encode(message), signal); return { exitCode }; };
  const paths: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    if (arg === "-v" || arg === "--version") return diagnostic("pdfunite version 24.08.0\n", 0);
    if (["-h", "-help", "--help", "-?"].includes(arg)) return diagnostic(pdfuniteUsage, 0);
    if (arg === "--") { paths.push(...argv.slice(i + 1)); break; }
    if (arg.startsWith("-")) return diagnostic(pdfuniteUsage, 99);
    paths.push(arg);
  }
  if (paths.length < 3) return diagnostic(pdfuniteUsage, 99);
  const destination = paths.pop()!, storage = { fs: context.fs, directory: resolvePath(context.cwd, context.env.TMPDIR || "/tmp") };
  const charged = new Set<string>(); let inputBytes = 0, totalPages = 0;
  async function* sources() {
    for (const path of paths) {
      let source: PdfFileSource | undefined, document: PdfRetainedDocument | undefined, failed = false;
      const damaged = `Syntax Error: Could not merge damaged documents ('${path}')\n`;
      try {
        try {
          const maximum = Math.min(limits.maxInputBytes, context.inputBudget?.maxBytes ?? Infinity);
          source = await PdfFileSource.open(context.fs, resolvePath(context.cwd, path), { signal, maxInputBytes: charged.has(path) ? maximum : maximum - inputBytes });
          if (!charged.has(path)) { inputBytes += source.size; charged.add(path); }
          context.inputBudget?.check(inputBytes);
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "EISDIR"].includes(String(error.code))) throw new MergeInputError(`I/O Error: Couldn't open file '${path}': No such file or directory.\n${damaged}`);
          throw error;
        }
        let count = 0;
        try {
          document = await PdfRetainedDocument.open(source, storage, { recovery: "repair", signal, maxDecodedBytes: limits.maxInputBytes, maxRecursionDepth: 128 });
          let objects = 0;
          for await (const entry of document.crossReference.index.entries(signal)) if (entry.type !== "free" && ++objects > limits.maxObjects) throw new RangeError("Object limit exceeded");
          if (document.encryption || dictGet(document.crossReference.trailer, "Encrypt")) throw new MergeInputError(`Unimplemented Feature: Could not merge encrypted files ('${path}')\n`);
          for await (const ignored of document.pages()) { if (++totalPages > limits.maxPages) throw new RangeError("Page limit exceeded"); count++; }
        } catch (error) {
          signal.throwIfAborted();
          if (error instanceof RangeError || (error instanceof PdfError && error.code === "E_LIMIT")) throw error;
          if (!(error instanceof PdfError)) throw error;
          throw new MergeInputError(`${error.code === "E_PASSWORD" || error.message === "Invalid PDF password" ? "Command Line Error: Incorrect password\n" : ""}${damaged}`);
        }
        function* indices() { for (let i = 0; i < count; i++) yield i; }
        yield { document, indices: indices() };
      } catch (error) { failed = true; throw error; }
      finally {
        const results = await Promise.allSettled([document?.close(), source?.close()]);
        if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
      }
    }
  }
  let output: PdfFileSource | undefined, failed = false;
  try {
    await context.fs.mkdir(storage.directory, { recursive: true, signal });
    const producer = copyRetainedPagesChunks(sources(), storage, { includeAttachments: true, includePageLabels: true, includeOutlines: true,
      signal, maxPages: limits.maxPages, maxOutputBytes: limits.maxOutputBytes, maxRecursionDepth: 128 });
    try { output = await PdfFileSource.fromStream(context.fs, storage.directory, producer, { signal, maxInputBytes: limits.maxOutputBytes }); }
    finally { await producer.return(undefined); }
    try { await publish(context, resolvePath(context.cwd, destination), output.stream(0, output.size, signal), signal); }
    catch (error) { signal.throwIfAborted(); if (!(error instanceof Error) || !("code" in error)) throw error; return await diagnostic(`I/O Error: Couldn't open file '${destination}'\n`); }
    return { exitCode: 0 };
  } catch (error) {
    failed = true; signal.throwIfAborted();
    if (error instanceof MergeInputError) return await diagnostic(error.message);
    throw error;
  } finally { await output?.close().catch(error => { if (!failed) throw error; }); }
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

