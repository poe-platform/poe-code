import { PdfFileSource, PdfRetainedDocument, PdfStagingStorage } from "@poe-code/pdf-ast";
import type { CommandContext } from "safe-bash-contracts/command";
import { FsError } from "safe-bash-contracts/errors";
import { writeFileOutput } from "safe-bash-contracts/filesystem-output-budget";
import { readBytes, writeBytes, type ByteSink } from "safe-bash-contracts/io";
import { resolvePath } from "safe-bash-contracts/path";
import { yieldTurn } from "safe-bash-contracts/yield";
import { encodePopplerChunks } from "./output-encoding.js";

interface RawTextPlan {
  readonly inputFile?: string;
  readonly outputFile?: string;
  readonly opw?: string;
  readonly upw?: string;
  readonly firstPage: number;
  readonly lastPage: number;
  readonly lastPageExplicit: boolean;
  readonly quiet: boolean;
  readonly invalidEolWarning: boolean;
  readonly nopgbrk: boolean;
  readonly nodiag: boolean;
  readonly clip: boolean;
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
 * retained storage. Other extraction modes keep their existing command path. */
export async function executeRetainedRawText(context: CommandContext, plan: RawTextPlan, stdout: ByteSink, signal: AbortSignal): Promise<{ exitCode: number }> {
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
    const maximum = context.inputBudget?.maxBytes ?? Infinity;
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
      const message = failure instanceof Error ? failure.message : String(failure);
      if (message.toLowerCase().includes("password") || message.toLowerCase().includes("encrypted")) return await error("Command Line Error: Incorrect password\n", 1);
      if (failure instanceof Error && "code" in failure && (failure.code === "E_LIMIT" || failure.code === "E_CAPABILITY")) throw failure;
      return await error(`Syntax Error: ${message}\n`, 1);
    }
    const first = Math.max(1, plan.firstPage);
    const last = !plan.lastPageExplicit || plan.lastPage === 0 || plan.lastPage > pageCount ? pageCount : plan.lastPage;
    if (first > pageCount || first > last) return await error(`Command Line Error: Wrong page range given: the first page (${first}) can not be after the last page (${last}).\n`, 99);
    const retained = document;
    async function* text() {
      for await (const page of retained.pages()) {
        await yieldTurn(signal);
        if (page.index + 1 < first) continue;
        if (page.index + 1 > last) break;
        yield* page.streamRawText(storage, { rejoinHyphens: false, discardDiagonal: plan.nodiag, clipText: plan.clip, signal });
        if (!plan.nopgbrk) yield new Uint8Array([12]);
      }
    }
    result = await PdfFileSource.fromStream(storage.fs, directory, encodePopplerChunks(text(), plan.encoding, plan.eol), { signal });
    if (warning) await writeBytes(context.stderr, encoder.encode(warning), signal);
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
