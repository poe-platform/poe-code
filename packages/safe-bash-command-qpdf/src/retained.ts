import { PdfError, PdfFileSource, PdfRetainedDocument, saveRetainedDocumentChunks } from "@poe-code/pdf-ast";
import type { CommandContext } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { writeBytes } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import type { QpdfLimits } from "./index.js";

export interface RetainedRewriteOptions {
  inputFile: string | undefined;
  outputFile: string | undefined;
  password: string | undefined;
  replaceInput: boolean;
  decrypt: boolean;
  warningExit0: boolean;
}
export async function executeRetainedRewrite(context: CommandContext, options: RetainedRewriteOptions, limits: QpdfLimits, signal: AbortSignal, inputBytes = 0): Promise<{ exitCode: number }> {
  const diagnostic = async (message: string) => { await writeBytes(context.stderr, new TextEncoder().encode(message), signal); return { exitCode: 2 }; };
  const inputName = options.inputFile;
  if (!inputName) return diagnostic("qpdf: an input file is required\n");
  const storage = { fs: context.fs, directory: resolvePath(context.cwd, context.env.TMPDIR || "/tmp") };
  let source: PdfFileSource | undefined, document: PdfRetainedDocument | undefined, output: PdfFileSource | undefined, failed = false, repaired = false;
  try {
    await context.fs.mkdir(storage.directory, { recursive: true, signal });
    const maximum = Math.min(limits.maxInputBytes, context.inputBudget?.maxBytes ?? Infinity) - inputBytes;
    try {
      source = inputName === "-" ? await PdfFileSource.fromStream(context.fs, storage.directory, context.stdin, { signal, maxInputBytes: maximum }) : await PdfFileSource.open(context.fs, resolvePath(context.cwd, inputName), { signal, maxInputBytes: maximum });
      context.inputBudget?.check(inputBytes + source.size);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "EISDIR"].includes(String(error.code))) return await diagnostic(`qpdf: cannot open ${inputName}\n`);
      throw error;
    }
    const openOptions = { signal, ...(options.password === undefined ? {} : { password: options.password }) };
    try {
      try { document = await PdfRetainedDocument.open(source, storage, openOptions); }
      catch (error) { signal.throwIfAborted(); if (!(error instanceof PdfError) || error.code === "E_LIMIT" || (error.code === "E_CAPABILITY" && error.message !== "Invalid PDF password")) throw error; document = await PdfRetainedDocument.open(source, storage, { ...openOptions, recovery: "repair" }); repaired = true; }
    } catch (error) {
      signal.throwIfAborted(); if (!(error instanceof PdfError) || error.code === "E_LIMIT" || (error.code === "E_CAPABILITY" && error.message !== "Invalid PDF password")) throw error;
      return await diagnostic(`qpdf: ${inputName}: ${error.message}\n`);
    }
    const destination = options.replaceInput ? inputName : options.outputFile;
    if (!destination) return await diagnostic("qpdf: an output file is required\n");
    if (!options.replaceInput && inputName !== "-" && destination === inputName) return await diagnostic("qpdf: output file may not be the same as the input file (use --replace-input)\n");
    const producer = saveRetainedDocumentChunks(document, storage, { signal, maxOutputBytes: limits.maxOutputBytes, ...(options.decrypt && document.encryption ? { version: "1.7", omitId: true } : {}) });
    try { output = await PdfFileSource.fromStream(context.fs, storage.directory, producer, { signal, maxInputBytes: limits.maxOutputBytes }); }
    finally { await producer.return(undefined); }
    if (destination === "-") { for await (const bytes of output.stream(0, output.size, signal)) await writeBytes(context.stdout, bytes, signal); }
    else {
      try { const path = resolvePath(context.cwd, destination); await context.fs.mkdir(resolvePath(path, ".."), { recursive: true, signal }); await publish(context, path, output.stream(0, output.size, signal), signal); }
      catch (error) {
        signal.throwIfAborted(); if (!(error instanceof Error) || !("code" in error)) throw error;
        return await diagnostic(`qpdf: open ${destination}: ${error.code === "ENOENT" ? "No such file or directory" : error.code}\n`);
      }
    }
    return { exitCode: repaired && !options.warningExit0 ? 3 : 0 };
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([document?.close(), source?.close(), output?.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
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

