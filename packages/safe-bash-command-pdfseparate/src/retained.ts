import { PdfError, PdfFileSource, PdfRetainedDocument, PdfStagedOutputs, copyRetainedPageChunks, type PdfOutputEntry } from "@poe-code/pdf-ast";
import type { CommandContext } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { writeBytes } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { parsePdfseparateSpec, type PdfseparatePlan } from "./parse.js";
import type { PdfseparateLimits } from "./index.js";

export async function executeRetainedSeparate(context: CommandContext, plan: PdfseparatePlan, limits: PdfseparateLimits, signal: AbortSignal): Promise<{ exitCode: number }> {
  const storage = { fs: context.fs, directory: resolvePath(context.cwd, context.env.TMPDIR || "/tmp") };
  const diagnostic = async (message: string) => { await writeBytes(context.stderr, new TextEncoder().encode(message), signal); return { exitCode: 99 }; };
  const damaged = `Syntax Error: Could not extract page(s) from damaged file ('${plan.srcPath}')\n`;
  let source: PdfFileSource | undefined, document: PdfRetainedDocument | undefined, outputs: PdfStagedOutputs | undefined, failed = false;
  try {
    await context.fs.mkdir(storage.directory, { recursive: true, signal });
    try {
      source = await PdfFileSource.open(context.fs, resolvePath(context.cwd, plan.srcPath), { signal,
        maxInputBytes: Math.min(limits.maxInputBytes, context.inputBudget?.maxBytes ?? Infinity) });
      context.inputBudget?.check(source.size);
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "EISDIR"].includes(String(error.code))) {
        return await diagnostic(`I/O Error: Couldn't open file '${plan.srcPath}': No such file or directory.\n${damaged}`);
      }
      throw error;
    }
    let count = 0;
    try {
      document = await PdfRetainedDocument.open(source, storage, { recovery: "repair", signal,
        maxDecodedBytes: limits.maxInputBytes, maxRecursionDepth: 128 });
      let objects = 0;
      for await (const entry of document.crossReference.index.entries(signal)) if (entry.type !== "free" && ++objects > limits.maxObjects) throw new RangeError("Object limit exceeded");
      for await (const ignored of document.pages()) { if (++count > limits.maxPages) throw new RangeError("Page limit exceeded"); }
    } catch (error) {
      signal.throwIfAborted();
      if (error instanceof RangeError || (error instanceof PdfError && error.code === "E_LIMIT")) throw error;
      if (!(error instanceof PdfError)) throw error;
      return await diagnostic(`${error.code === "E_PASSWORD" || error.message === "Invalid PDF password" ? "Command Line Error: Incorrect password\n" : ""}${damaged}`);
    }
    const end = plan.lastPage > 0 ? Math.min(count, plan.lastPage) : count;
    if (plan.firstPage > count || (plan.lastPage > 0 && (plan.lastPage > count || plan.firstPage > plan.lastPage))) {
      return await diagnostic(`Command Line Error: Wrong page range given: the first page (${plan.firstPage}) can not be after the last page (${end}).\n`);
    }
    const spec = parsePdfseparateSpec(plan.pattern);
    if (end > plan.firstPage && !spec.hasPageSpec) return await diagnostic(`Error: '${plan.pattern}' must contain '%d' if more than one page should be extracted\n`);
    const doc = document; let outputBytes = 0;
    async function* entries(): AsyncGenerator<PdfOutputEntry> {
      for (let page = plan.firstPage; page <= end; page++) {
        const producer = copyRetainedPageChunks(doc, page - 1, storage, { signal, maxOutputBytes: limits.maxOutputBytes - outputBytes, maxRecursionDepth: 128 });
        async function* chunks() { for await (const bytes of producer) { if (bytes.length > limits.maxOutputBytes - outputBytes) throw new RangeError("Output byte limit exceeded"); outputBytes += bytes.length; yield bytes; } }
        try { yield { name: spec.format(page), chunks: chunks() }; }
        finally { await producer.return(undefined); }
      }
    }
    const producer = entries();
    try { outputs = await PdfStagedOutputs.create(storage, producer, { signal }); }
    finally { await producer.return(undefined); }
    for await (const entry of outputs.entries()) {
      try { await publish(context, resolvePath(context.cwd, entry.name), entry.contents(), signal); }
      catch (error) { signal.throwIfAborted(); if (!(error instanceof Error) || !("code" in error)) throw error; return await diagnostic(`I/O Error: Couldn't open file '${entry.name}'\n`); }
    }
    return { exitCode: 0 };
  } catch (error) { failed = true; throw error; }
  finally { const results = await Promise.allSettled([outputs?.close(), document?.close(), source?.close()]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason); }
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

