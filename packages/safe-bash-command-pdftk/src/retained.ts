import { retainedFdf } from "./retained-fdf.js";
import { retainedFieldReport } from "./retained-fields.js";
import { PdfError, PdfFileSource, PdfRetainedDocument, retainedCosObjects } from "@poe-code/pdf-ast";
import type { CommandContext } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { writeBytes } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import type { PdftkArguments } from "./arguments.js";
import { retainedAnnotationReport } from "./retained-annots.js";

export async function executeRetainedPdftk(context: CommandContext, options: PdftkArguments): Promise<{ exitCode: number }> {
  const signal = context.signal, storage = { fs: context.fs, directory: resolvePath(context.cwd, context.env.TMPDIR || "/tmp") };
  const inputs = new Map<string, PdfFileSource | undefined>();
  let document: PdfRetainedDocument | undefined, output: PdfFileSource | undefined, total = 0, failed = false;
  const diagnostic = async (message: string) => { await writeBytes(context.stderr, new TextEncoder().encode(message), signal); return { exitCode: 1 }; };
  try {
    await context.fs.mkdir(storage.directory, { recursive: true, signal });
    const maximum = context.inputBudget?.maxBytes ?? Infinity;
    if (options.inputs.some(input => input.file === "-")) {
      const source = await PdfFileSource.fromStream(context.fs, storage.directory, context.stdin, { signal, maxInputBytes: maximum });
      inputs.set("-", source); total += source.size; context.inputBudget?.check(total);
    }
    for (const input of options.inputs) {
      if (inputs.has(input.file)) continue;
      let source: PdfFileSource;
      try { source = await PdfFileSource.open(context.fs, resolvePath(context.cwd, input.file), { signal, maxInputBytes: maximum - total }); }
      catch (error) {
        signal.throwIfAborted();
        if ((error instanceof Error && "code" in error && ["ENOENT", "ENOTDIR", "EACCES", "EISDIR"].includes(String(error.code))) || (error instanceof PdfError && error.message === "PDF source must be a regular file")) { inputs.set(input.file, undefined); continue; }
        throw error;
      }
      inputs.set(input.file, source); total += source.size; context.inputBudget?.check(total);
    }
    // Validate every supplied document in operand order, but keep only one
    // object's/page's state active at a time, including unused secondary inputs.
    for (const input of options.inputs) {
      const source = inputs.get(input.file); if (!source) return await diagnostic(`Error: Unable to find file '${input.file}'\n`);
      try {
        document = await PdfRetainedDocument.open(source, storage, { signal, recovery: "strict", ...(input.password ? { password: input.password } : {}) });
        for await (const object of retainedCosObjects(document, storage, { signal })) if (object.stream) for await (const ignored of object.stream.chunks) void ignored;
        for await (const ignored of document.pages()) void ignored;
      } catch (error) {
        signal.throwIfAborted();
        if (!(error instanceof PdfError) || error.code === "E_LIMIT" || error.code === "E_CANCELLED") throw error;
        return await diagnostic(`Error: Failed to open PDF '${input.file}': ${error.message}\n`);
      }
      await document.close(); document = undefined; await source.releaseCache();
    }
    const primary = options.inputs[0]!;
    document = await PdfRetainedDocument.open(inputs.get(primary.file)!, storage, { signal, recovery: "strict", ...(primary.password ? { password: primary.password } : {}) });
    output = await PdfFileSource.fromStream(context.fs, storage.directory, (options.operation === "generate_fdf" ? retainedFdf(document, storage, signal) : options.operation === "dump_data_fields" || options.operation === "dump_data_fields_utf8" ? retainedFieldReport(document, options.operation.endsWith("_utf8"), signal) : retainedAnnotationReport(document, storage, options.operation.endsWith("_utf8"), signal)), { signal });
    const destination = options.outputTarget;
    if (!destination || destination === "-") for await (const bytes of output.stream(0, output.size, signal)) await writeBytes(context.stdout, bytes, signal);
    else {
      try { await publish(context, resolvePath(context.cwd, destination), output); }
      catch (error) {
        signal.throwIfAborted(); if (!(error instanceof Error) || !("code" in error)) throw error;
        return await diagnostic(`Error: Failed to open output file '${destination}': ${error.code}.\n`);
      }
    }
    return { exitCode: 0 };
  } catch (error) { failed = true; throw error; }
  finally {
    const results = await Promise.allSettled([document?.close(), output?.close(), ...[...inputs.values()].map(source => source?.close())]);
    if (!failed) for (const result of results) if (result.status === "rejected") await Promise.reject(result.reason);
  }
}

async function publish(context: CommandContext, path: string, source: PdfFileSource): Promise<void> {
  const fs = context.fs, signal = context.signal;
  const capabilities = await fs.capabilitiesFor?.(path, { signal, create: true, stagingAncestry: true }) ?? fs.capabilities;
  if (!capabilities.atomicFileStaging || !capabilities.retainedStagingWrite || !capabilities.retainedStagingCleanup || !capabilities.atomicStagingAncestry || !fs.prepareStagingResolution || !fs.createStagedFile || !fs.publishStagedFile) throw new FsError("ENOTSUP", { path, message: "PDF output requires retained atomic staging" });
  const resolution = await fs.prepareStagingResolution(path, { signal }), directory = resolvePath(resolution.path, "..");
  const staging = await fs.createStagedFile(`${directory}/.pdf-${crypto.randomUUID()}`, "output", { type: "file", data: new Uint8Array() }, { parent: resolution.parent, retainCleanup: true, signal });
  let failed = false;
  try {
    if (!staging.writer || !staging.cleanup) throw new FsError("ENOTSUP", { path, message: "PDF backend omitted retained staging handles" });
    for await (const bytes of source.stream(0, source.size, signal)) await writeFileOutput(context, bytes, data => staging.writer!.write(data, { signal }));
    const stat = await staging.writer.finish({ signal });
    await fs.publishStagedFile({ ...staging, file: { ...staging.file, stat } }, resolution.path, { parent: resolution.parent, destination: resolution.destination, ancestors: resolution.ancestors, commitGuard: resolution.validate, signal });
  } catch (error) { failed = true; throw error; }
  finally {
    const cleanup = async () => { try { await staging.cleanup?.remove(); } finally { await staging.cleanup?.close(); } };
    await cleanup().catch(error => { if (!failed) throw error; });
  }
}
