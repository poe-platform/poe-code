import { openDatasourceSession } from "./datasource.js";
import { snapshotRuntimeFunctions } from "./formulas/runtime-functions.js";
import { createRegistry } from "./codecs.js";
import { serializeClipboard } from "./conversion/clipboard.js";
import { runtimeEnvironment } from "./locale/runtime.js";
import {
  SsconvertError,
  type EngineConfig,
  type Engine,
  type CapabilityContext,
  type Cleanup,
  type Operation,
  type Input,
  type Destination,
  type ConversionRequest,
  type OperationResult,
  type Diagnostic,
  type RuntimeLimits
} from "./contracts.js";
import { snapshotWorkbook, type Workbook } from "./workbook.js";
import { snapshotRecords } from "./workbook/model.js";
import { admitByteStringExport } from "./codecs/byte-strings.js";
import { parseRangeExpression } from "./workbook/expressions.js";
import { exportOptionPairs } from "./cli/export-options.js";
import { applyExportOption } from "./codecs/export-options.js";
import { CodecWriteFailure } from "./codecs/write-failure.js";
import { ioFailure, FileWriteError } from "./io-errors.js";
import { foldSheetName } from "./workbook/case-fold.js";
import { resourceUri } from "./resource-uri.js";
import { resourceBasename } from "./io/names.js";
import { mergeWorkbookSheets } from "./workbook/merge.js";
import { createImageRendering, ImageExportError } from "./rendering/images/index.js";
import { runConversionTransforms } from "./conversion/transforms.js";
import { resolveOutput, imageFormat, conversionUri } from "./conversion/output.js";
import { splitOutput } from "./conversion/split.js";
import { applyConversionUpdates } from "./conversion/updates.js";
import { prepareWorkbookLoad } from "./conversion/load.js";
import { validateImageOptions } from "./conversion/image-options.js";
import { createFormattingCapability } from "./formatting.js";

export const defaultSsconvertLimits: Readonly<RuntimeLimits> = Object.freeze({
  inputBytes: Infinity,
  outputBytes: Infinity,
  cells: Infinity,
  sheets: Infinity,
  operations: Infinity,
  workbookNodes: Infinity,
  workbookTextBytes: Infinity,
  workbookWork: Infinity,
  argumentBytes: Infinity,
  commandOutputBytes: Infinity,
  compressedBytes: Infinity,
  inflatedBytes: Infinity,
  encryptionMemoryBytes: Infinity,
  zipEntries: Infinity,
  zipRatio: Infinity,
  xmlDepth: Infinity,
  splitOutputs: Infinity,
});

type ResolvedRequest = ConversionRequest & { readonly destination: Destination };

const unsupported = (feature: string): never => {
  throw new SsconvertError("unsupported-feature", `Unsupported ssconvert feature: ${feature}`);
};
function bounded(value: number, maximum: number, name: string) {
  if (!Number.isSafeInteger(value) || value < 0 || value > maximum)
    throw new SsconvertError("resource-limit", `ssconvert ${name} limit exceeded`);
}

/** No host work occurs until an operation supplies cancellation and explicit I/O. */
export function createEngine(supplied: EngineConfig): Engine {
  const config = {
    ...supplied,
    ...(supplied.entropy === undefined ? {} : { entropy: Object.freeze({ read: supplied.entropy.read.bind(supplied.entropy) }) }),
    ...(supplied.datasource === undefined ? {} : { datasource: Object.freeze({ open: supplied.datasource.open.bind(supplied.datasource) }) }),
    ...(supplied.fonts === undefined ? {} : { fonts: Object.freeze({ resolve: supplied.fonts.resolve.bind(supplied.fonts) }) }),
    ...(supplied.password === undefined ? {} : { password: Object.freeze({ read: supplied.password.read.bind(supplied.password) }) }),
    ...(supplied.runtimeFunctions === undefined ? {} : { runtimeFunctions: snapshotRuntimeFunctions(supplied.runtimeFunctions) }),
    limits: Object.freeze({ ...defaultSsconvertLimits, ...supplied.limits }),
    environment: Object.freeze({
      ...supplied.environment,
      cwd: supplied.filesystem?.cwd ?? supplied.environment.cwd ?? supplied.environment.env.PWD ?? "/",
      env: Object.freeze({ ...supplied.environment.env })
    })
  };
  if (config.datasource && Object.hasOwn(config.runtimeFunctions ?? {}, "ATL_LAST"))
    throw new TypeError("Conflicting ssconvert datasource runtime function: ATL_LAST");
  if ((supplied.filesystem?.cwd !== undefined || supplied.environment.cwd !== undefined) &&
      (!config.environment.cwd.startsWith("/") || config.environment.cwd.includes("\0")))
    throw new TypeError("ssconvert cwd must be an absolute VFS path");
  for (const name of ["inputBytes", "outputBytes", "cells", "sheets", "operations"] as const) {
    const value = config.limits[name];
    if (value !== Infinity && (!Number.isSafeInteger(value) || value < 0))
      throw new TypeError(`Invalid ssconvert limit: ${name}`);
  }
  for (const name of ["workbookNodes", "workbookTextBytes", "workbookWork", "argumentBytes", "commandOutputBytes", "compressedBytes", "inflatedBytes", "encryptionMemoryBytes", "zipEntries", "zipRatio", "xmlDepth", "splitOutputs"] as const) {
    const value = config.limits[name];
    if (value !== undefined && value !== Infinity && (!Number.isSafeInteger(value) || value < 0))
      throw new TypeError(`Invalid ssconvert limit: ${name}`);
  }
  const registry = createRegistry(config.codecs);
  const formatting = config.formatting ?? createFormattingCapability();
  const rendering = config.rendering ?? createImageRendering();
  const books = new WeakSet<Workbook>();
  const active = new Set<Promise<unknown>>();
  let disposed = false;
  let disposal: Promise<void> | undefined;
  const admissions = new WeakMap<CapabilityContext, () => void>();
  const diagnostics = new WeakMap<CapabilityContext, Diagnostic[]>();
  function check(context: CapabilityContext) {
    context.signal.throwIfAborted();
    admissions.get(context)!();
  }

  async function session<T>(
    operation: Operation,
    work: (context: CapabilityContext) => Promise<T>
  ): Promise<T> {
    if (disposed) throw new SsconvertError("invalid-request", "ssconvert engine is disposed");
    operation.signal.throwIfAborted();
    const cleanups: Cleanup[] = [];
    let diagnosticBytes = 0;
    let closed = false;
    let closing: Promise<void> | undefined;
    const execution: { running?: Promise<T> } = {};
    const finish = (): Promise<void> => {
      closed = true;
      return (closing ??= Promise.resolve().then(async () => {
        const failures: unknown[] = [];
        for (const cleanup of cleanups.reverse())
          try {
            await cleanup();
          } catch (error) {
            failures.push(error);
          }
        if (failures.length) throw new AggregateError(failures, "ssconvert cleanup failed");
      }));
    };
    let registeredClosing: Promise<void> | undefined;
    operation.registerCleanup?.(() => {
      const cleanup = finish();
      return (registeredClosing ??= Promise.allSettled([cleanup, execution.running]).then(results => {
        const failure = results[0]!;
        if (failure.status === "rejected") throw failure.reason;
      }));
    });
    const abort = () => { void finish().catch(() => {}); };
    operation.signal.addEventListener("abort", abort, { once: true });
    let context: CapabilityContext = {
      signal: operation.signal,
      ...(operation.stdinIsDefault === undefined ? {} : { stdinIsDefault: operation.stdinIsDefault }),
      environment: runtimeEnvironment(config.environment),
      limits: config.limits,
      ...(config.entropy === undefined ? {} : { entropy: config.entropy }),
      formatting,
      ...(config.clock === undefined ? {} : { clock: config.clock }),
      ...(config.random === undefined ? {} : { random: config.random }),
      ...(config.runtimeFunctions === undefined ? {} : { runtimeFunctions: config.runtimeFunctions }),
      ...(config.externalReferences === undefined ? {} : { externalReferences: config.externalReferences }),
      ...(config.fonts === undefined ? {} : { fonts: config.fonts }),
      ...(config.password === undefined ? {} : { password: config.password }),
      async diagnostic(supplied) {
        check(context);
        let textBytes = 0;
        for (const character of supplied.message) {
          const code = character.codePointAt(0)!;
          textBytes += code < 128 ? 1 : code < 2048 ? 2 : code < 65536 ? 3 : 4;
          bounded(textBytes, config.limits.outputBytes, "diagnostic bytes");
        }
        diagnosticBytes += Math.max(textBytes + 1, supplied.bytes?.byteLength ?? 0);
        bounded(diagnosticBytes, config.limits.outputBytes, "diagnostic bytes");
        const diagnostic = Object.freeze({ ...supplied,
          ...(supplied.bytes === undefined ? {} : { bytes: new Uint8Array(supplied.bytes) }) });
        diagnostics.get(context)!.push(diagnostic);
        await operation.diagnostic?.(diagnostic);
        check(context);
      },
      own(cleanup) {
        if (closed)
          throw new SsconvertError("invalid-request", "ssconvert ownership admission is closed");
        cleanups.push(cleanup);
      }
    };
    diagnostics.set(context, []);
    admissions.set(context, () => {
      if (closed)
        throw new SsconvertError("invalid-request", "ssconvert ownership admission is closed");
    });
    const running = Promise.resolve().then(async () => {
      let result: T;
      try {
        check(context);
        if (config.datasource) {
          const datasource = await openDatasourceSession(config.datasource, context);
          const records = diagnostics.get(context)!;
          const admission = admissions.get(context)!;
          context = { ...context, datasource, runtimeFunctions: { ...context.runtimeFunctions, ...datasource.runtimeFunctions } };
          diagnostics.set(context, records); admissions.set(context, admission);
          check(context);
        }
        result = await work(context);
        check(context);
      } catch (error) {
        try {
          await finish();
        } catch (cleanup) {
          throw new AggregateError([error, cleanup], "ssconvert operation and cleanup failed");
        }
        throw error;
      }
      await finish();
      return result;
    });
    execution.running = running;
    active.add(running);
    try {
      return await running;
    } finally {
      operation.signal.removeEventListener("abort", abort);
      active.delete(running);
    }
  }
  function retain(book: Workbook, limits: RuntimeLimits = config.limits) {
    const owned = snapshotWorkbook(book, limits);
    books.add(owned);
    return owned;
  }
  async function read(
    input: Input,
    type: string | undefined,
    encoding: string | undefined,
    context: CapabilityContext,
    maximumBytes = config.limits.inputBytes,
    storageLimits: RuntimeLimits = config.limits
  ): Promise<{ book: Workbook; bytes: number }> {
    check(context);
    const filename = input.kind === "resource" ? input.uri : input.filename;
    const forced = type === undefined ? undefined : registry.select("read", type);
    if (type !== undefined && !forced?.read)
      throw new SsconvertError("invalid-request", `Unknown importer '${type}'.\nTry --list-importers to see a list of possibilities.`);
    if (input.kind === "resource" && !config.filesystem)
      throw new SsconvertError("capability-denied", "Filesystem read capability is required");
    const identity = resourceUri(filename ?? "(unspecified)", config.environment.cwd);
    let display = identity;
    if (identity.startsWith("file:///")) {
      try { display = decodeURIComponent(identity.slice(7)); }
      catch { /* Keep an invalid explicit URI from masking the original I/O error. */ }
    }
    let source;
    try {
      source = input.kind === "stream" ? input.source : await config.filesystem!.read(input.uri, context.signal);
    } catch (error) {
      check(context);
      ioFailure(error, display, "read");
    }
    check(context);
    const chunks: Uint8Array[] = [];
    let size = 0;
    let readWork = 0;
    let iterator: AsyncIterator<Uint8Array> | Iterator<Uint8Array> | undefined;
    let completed = false;
    let sourceFailed = false;
    let sourceFailure: unknown;
    let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      if (closing) return closing;
      if (completed || !iterator?.return) return (closing = Promise.resolve());
      closing = Promise.resolve().then(() => iterator!.return!()).then(() => undefined, error => {
        if (sourceFailed && error === sourceFailure) return;
        throw error;
      });
      return closing;
    };
    context.own(close);
    const abort = () => { void close().catch(() => {}); };
    context.signal.addEventListener("abort", abort, { once: true });
    try {
      check(context);
      iterator = Symbol.asyncIterator in source ? source[Symbol.asyncIterator]() : source[Symbol.iterator]();
      while (true) {
        check(context);
        const next = await iterator.next();
        check(context);
        if (next.done) { completed = true; break; }
        bounded(++readWork, config.limits.workbookWork ?? Math.max(1, maximumBytes), "input chunks");
        const chunk = next.value;
        bounded(chunk.byteLength, maximumBytes - size, "input bytes");
        size += chunk.byteLength;
        if (chunk.byteLength) chunks.push(new Uint8Array(chunk));
      }
    } catch (error) {
      sourceFailed = true;
      sourceFailure = error;
    } finally {
      context.signal.removeEventListener("abort", abort);
    }
    try { await close(); }
    catch (error) {
      if (sourceFailed) throw new AggregateError([sourceFailure, error], "ssconvert source and cleanup failed");
      throw error;
    }
    if (sourceFailed) {
      check(context);
      ioFailure(sourceFailure, display, "read");
    }
    check(context);
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const importContext = { ...context, ...(filename === undefined ? {} : { inputFilename: filename }) };
    const codec = forced ?? await registry.probe(bytes, filename, importContext);
    if (!codec?.read) throw new SsconvertError("io", `E Unsupported file format for file "${resourceBasename(filename, config.environment.cwd)}"`);
    const decoded = await codec.read(bytes, importContext, encoding);
    check(context);
    const book = retain(decoded, storageLimits);
    check(context);
    return { book, bytes: size };
  }
  async function prepareExport(book: Workbook, destination: Destination, type: string | undefined,
    options: readonly string[], context: CapabilityContext, request?: ConversionRequest) {
    const codec = exporter(destination, type);
    bounded(options.length, config.limits.operations, "export options");
    let selected = request?.selection?.kind === "ids" ? [...request.selection.ids] : undefined;
    if (!codec.exportOptions) {
      for (const text of options) for (const [key, value] of exportOptionPairs(text)) {
        check(context);
        const rule = Object.hasOwn(codec.exportOptionRules ?? {}, key) ? codec.exportOptionRules![key] : undefined;
        if (rule) applyExportOption(rule, key, value);
        else if (key === "sheet" || key === "active-sheet") {
          const sheet = key === "active-sheet" ? book.sheets.find((sheet) => sheet.id === book.activeSheet) ?? book.sheets[0] :
            book.sheets.find((sheet) => foldSheetName(sheet.name) === foldSheetName(value));
          if (!sheet) throw new SsconvertError("invalid-request", `ssconvert: Unknown sheet "${value}"`);
          (selected ??= []).push(sheet.id);
          bounded(selected.length, config.limits.operations, "sheet selection");
        } else
          throw new SsconvertError("invalid-request", `ssconvert: Invalid export option "${key}" for format ${codec.id}`);
      }
    }
    const exporterOptions = codec.exportOptions
      ? await codec.exportOptions(Object.freeze([...options]), context, book) : Object.freeze([...options]);
    check(context);
    bounded(exporterOptions.length, config.limits.operations, "export options");
    if (request?.perSheet) {
      if (codec.saveScope === "range" || (codec.saveScope === "workbook" && !codec.sheetSelection))
        throw new SsconvertError("invalid-request", `Selected exporter (${codec.id}) does not have the ability to split a workbook into sheets.`);
    }
    if (selected) {
      if (!request?.perSheet && codec.saveScope === "sheet" && selected.length !== 1)
        throw new SsconvertError("invalid-request", `Selected exporter (${codec.id}) can only export one sheet at a time.`);
      if (!request?.perSheet && codec.saveScope !== "sheet" && !codec.sheetSelection)
        throw new SsconvertError("invalid-request", `Selected exporter (${codec.id}) does not have the ability to export a subset of sheets.`);
      for (const id of selected)
        if (!book.sheets.some((sheet) => sheet.id === id))
          throw new SsconvertError("invalid-request", `ssconvert: Unknown sheet "${id}"`);
    }
    return { codec, options: Object.freeze([...exporterOptions]), split: request?.perSheet ?? false,
      ...(selected === undefined ? {} : { selected: Object.freeze(selected) }) };
  }
  async function publishBytes(destination: Destination, bytes: Uint8Array, context: CapabilityContext,
    inputBytes: number, maximumBytes: number, output?: import("./contracts.js").FileOutput): Promise<OperationResult> {
    check(context);
    bounded(bytes.byteLength, maximumBytes, "output bytes");
    if (destination.kind === "stream") await destination.sink.write(bytes);
    else {
      if (!config.filesystem) throw new SsconvertError("capability-denied", "Filesystem write capability is required");
      try {
        if (output) { await output.write(bytes); check(context); await output.close(); }
        else await config.filesystem.write(destination.uri, bytes, context.signal);
      } catch (error) { check(context); ioFailure(error, resourceUri(destination.uri, config.environment.cwd), "write"); }
    }
    check(context);
    return { exitCode: 0, diagnostics: Object.freeze([...diagnostics.get(context)!]),
      artifacts: [{ ...(destination.kind === "resource" ? { uri: destination.uri } : {}), bytes: bytes.byteLength }],
      usage: { inputBytes, outputBytes: bytes.byteLength }, profile: "gnumeric-1.12.61" };
  }
  async function write(
    book: Workbook,
    destination: Destination,
    type: string | undefined,
    options: readonly string[],
    context: CapabilityContext,
    inputBytes: number,
    prepared?: Awaited<ReturnType<typeof prepareExport>>,
    maximumBytes = config.limits.outputBytes,
    range?: import("./workbook.js").CellRange
  ): Promise<OperationResult> {
    check(context);
    const selection = prepared ?? await prepareExport(book, destination, type, options, context);
    const active = book.activeSheet ?? book.sheets[0]?.id;
    const runtimeSheets = !selection.split && range ? [range.sheet] : selection.split ? selection.selected : undefined;
    const sheets = selection.codec.selectionSource === "view" ? (active === undefined ? [] : [active]) :
      selection.codec.selectionSource === "runtime" ? runtimeSheets ?? (active === undefined ? [] : [active]) :
      selection.codec.saveScope === "workbook" && !selection.codec.sheetSelection ? undefined :
      runtimeSheets ?? selection.selected ?? (selection.codec.saveScope !== "workbook"
        ? (active === undefined ? [] : [active]) : undefined);
    const exportRange = selection.codec.honorsExportRange ? range : undefined;
    const writerSelection = sheets === undefined && exportRange === undefined ? undefined : Object.freeze({ sheets: Object.freeze([...(sheets ?? [])]),
      ...(exportRange === undefined ? {} : { range: exportRange }) });
    admitByteStringExport(book, selection.codec, context, writerSelection, selection.options);
    const output = destination.kind === "resource" ? await config.filesystem?.openOutput?.(destination.uri, context) : undefined;
    check(context);
    let bytes: Uint8Array;
    try {
      bytes = await selection.codec.write!(book, selection.options, destination.kind === "resource" ? { ...context, outputFilename: destination.uri } : context,
        writerSelection);
    } catch (error) {
      if (error instanceof CodecWriteFailure) {
        await publishBytes(destination, error.bytes, context, inputBytes, maximumBytes, output);
        throw error;
      }
      await output?.abort(); throw error;
    }
    check(context);
    return publishBytes(destination, bytes, context, inputBytes, maximumBytes, output);
  }
  async function saveConversion(book: Workbook, request: ResolvedRequest, context: CapabilityContext,
    inputBytes: number, prepared?: Awaited<ReturnType<typeof prepareExport>>, range?: import("./workbook.js").CellRange) {
    if (request.clipboard !== undefined) {
      if (!range) throw new SsconvertError("invalid-request", "Invalid range specified.");
      const bytes = config.clipboard ? await config.clipboard.serialize(book, request.clipboard, range, context) :
        await serializeClipboard(book, request.clipboard, range, context, id => registry.select("write", id));
      check(context);
      bounded(bytes.byteLength, config.limits.outputBytes, "output bytes");
      try {
        const output = request.destination.kind === "resource" ? await config.filesystem?.openOutput?.(request.destination.uri, context) : undefined;
        return await publishBytes(request.destination, bytes, context, inputBytes, config.limits.outputBytes, output);
      } catch (error) {
        check(context);
        if (request.destination.kind === "resource") {
          const uri = resourceUri(request.destination.uri, config.environment.cwd);
          try { ioFailure(error, uri, "write"); }
          catch (failure) {
            if (failure instanceof FileWriteError) throw new SsconvertError("io", `Failed to write to ${uri}`);
            throw failure;
          }
        }
        throw error;
      }
    }
    if (request.graphs) {
      if (request.destination.kind !== "resource") unsupported("graph output template");
      const resolution = book.sheets.length ? validateImageOptions(request.exportOptions ?? []) : 100;
      const artifacts: OperationResult["artifacts"][number][] = [];
      let outputBytes = 0;
      const destination = request.destination;
      if (destination.kind !== "resource") return unsupported("graph output template");
      const graph = { template: destination.uri, resolution,
        format: imageFormat(destination, request.exportType, config.environment.cwd),
        options: request.exportOptions ?? [],
        canVisitSheet(sheet: string) {
          check(context);
          return failedSheet === undefined || sheet === failedSheet;
        } };
      let fileIndex = 0;
      let attemptedBytes = 0;
      let failedSheet: string | undefined;
      for await (const artifact of rendering.exportGraphs(book, graph, context)) {
        check(context);
        if (failedSheet !== undefined && artifact.sheet !== failedSheet) break;
        const sheet = artifact.sheet === undefined ? undefined : book.sheets.find(sheet => sheet.id === artifact.sheet);
        if (artifact.sheet !== undefined && !sheet)
          throw new SsconvertError("invalid-request", `ssconvert: Unknown sheet "${artifact.sheet}"`);
        bounded(fileIndex + 1, config.limits.splitOutputs ?? config.limits.operations, "split outputs");
        const index = fileIndex++;
        const uri = sheet ? splitOutput(destination.uri, sheet, index,
          config.environment.cwd, artifact.objectName).uri : artifact.uri;
        const availableBytes = config.limits.outputBytes - attemptedBytes;
        let output: import("./contracts.js").FileOutput | undefined;
        try {
          output = await config.filesystem?.openOutput?.(uri, context);
          check(context);
          let bytes: Uint8Array;
          try { bytes = artifact.render ? await artifact.render() : artifact.bytes; }
          catch (error) {
            check(context);
            if (!(error instanceof ImageExportError)) throw error;
            // Native opens/truncates the namespace before it knows whether the
            // image target can encode this object, then closes even on failure.
            if (output) await output.close();
            else await publishBytes({ kind: "resource", uri }, new Uint8Array(), context,
              inputBytes, availableBytes);
            throw error;
          }
          check(context);
          bounded(bytes.byteLength, availableBytes, "output bytes");
          // A failing capability may already have written bytes. Do not refund its admission.
          attemptedBytes += bytes.byteLength;
          const result = await publishBytes({ kind: "resource", uri }, bytes, context,
            inputBytes, availableBytes, output);
          artifacts.push(...result.artifacts);
          outputBytes += result.usage.outputBytes;
        } catch (error) {
          if (context.signal.aborted) await output?.abort();
          check(context);
          if (!sheet || (!(error instanceof FileWriteError) && !(error instanceof ImageExportError))) {
            await output?.abort(); throw error;
          }
          failedSheet = sheet.id;
          await context.diagnostic?.({ code: "graph-write", severity: "error",
            message: `Failed to write ${uri}: ${error instanceof FileWriteError ? error.detail : error.message}` });
        }
      }
      return { exitCode: failedSheet === undefined ? 0 : 1, diagnostics: Object.freeze([...diagnostics.get(context)!]), artifacts,
        usage: { inputBytes, outputBytes }, profile: "gnumeric-1.12.61" as const };
    }
    if (!prepared) throw new SsconvertError("invalid-request", "ssconvert exporter was not prepared");
    if (!request.perSheet)
      return write(book, request.destination, request.exportType, request.exportOptions ?? [], context, inputBytes, prepared,
        config.limits.outputBytes, range);
    const destination = request.destination;
    if (destination.kind !== "resource") return unsupported("split stream template");
    const artifacts: OperationResult["artifacts"][number][] = [];
    let outputBytes = 0;
    const sheets = prepared.selected === undefined ? book.sheets : prepared.selected.map((id) => book.sheets.find((sheet) => sheet.id === id)!);
    bounded(sheets.length, config.limits.splitOutputs ?? config.limits.sheets, "split outputs");
    for (const [index, sheet] of sheets.entries()) {
      check(context);
      // Native exporters without sheet-selection find the selected sheet at the front.
      const view = prepared.codec.sheetSelection ? book : retain({ ...book,
        sheets: [sheet, ...book.sheets.filter((candidate) => candidate.id !== sheet.id)], activeSheet: sheet.id });
      const result = await write(view,
        splitOutput(destination.uri, sheet, index, config.environment.cwd),
        request.exportType, request.exportOptions ?? [], context, inputBytes,
        { ...prepared, selected: Object.freeze([sheet.id]) }, config.limits.outputBytes - outputBytes, range);
      outputBytes += result.usage.outputBytes;
      artifacts.push(...result.artifacts);
    }
    return { exitCode: 0, diagnostics: Object.freeze([...diagnostics.get(context)!]), artifacts,
      usage: { inputBytes, outputBytes }, profile: "gnumeric-1.12.61" as const };
  }
  function preflight(request: ResolvedRequest, inputOperations = 0) {
    bounded(
      inputOperations + (request.updates?.length ?? 0) +
        (request.updateExpressions?.length ?? 0) +
        (request.goalSeekExpressions?.length ?? 0) +
        (request.toolTest?.length ?? 0) + Number(request.resizeExpression !== undefined) +
        (request.goalSeek?.length ?? 0) +
        (request.exportOptions?.length ?? 0) +
        Number(Boolean(request.recalc)) +
        Number(Boolean(request.solve)) +
        Number(Boolean(request.analysis)),
      config.limits.operations,
      "operations"
    );
    if (!request.graphs && request.clipboard === undefined) exporter(request.destination, request.exportType);
    if (request.selection?.kind === "ids") bounded(request.selection.ids.length, config.limits.operations, "sheet selection");
    if (request.destination.kind === "resource" && !config.filesystem)
      throw new SsconvertError("capability-denied", "Filesystem write capability is required");
  }
  function requireCapabilities(request: ConversionRequest) {
    if (request.clipboard === undefined && request.importType !== undefined && !registry.select("read", request.importType)?.read)
      throw new SsconvertError("invalid-request", `Unknown importer '${request.importType}'.\nTry --list-importers to see a list of possibilities.`);
  }
  function exporter(destination: Destination, type: string | undefined) {
    const codec = registry.select("write", type, destination.kind === "resource" ? conversionUri(destination.uri, config.environment.cwd) : undefined);
    if (codec?.write) return codec;
    if (type !== undefined)
      throw new SsconvertError("invalid-request", `Unknown exporter '${type}'.\nTry --list-exporters to see a list of possibilities.`);
    if (destination.kind === "resource")
      throw new SsconvertError("invalid-request", `Unable to guess exporter to use for '${conversionUri(destination.uri, config.environment.cwd)}'.\nTry --list-exporters to see a list of possibilities.`, 2);
    return unsupported("exporter (unspecified)");
  }
  function capture(supplied: ConversionRequest, inputOperations = 0): ResolvedRequest {
    const request = { ...supplied, destination: resolveOutput(supplied, registry.list("write"), config.environment.cwd) };
    if (request.graphs) request.exportType = imageFormat(request.destination, request.exportType, config.environment.cwd);
    preflight(request, inputOperations);
    if (request.analysis) {
      bounded(request.analysis.properties.length, config.limits.operations, "analysis properties");
      if (request.analysis.toolOptions)
        bounded(Object.keys(request.analysis.toolOptions.properties).length, config.limits.operations, "analysis properties");
    }
    return Object.freeze({
      ...request,
      input: Object.freeze({ ...request.input }),
      destination: Object.freeze({ ...request.destination }),
      ...(request.updates === undefined
        ? {}
        : {
            updates: snapshotRecords(request.updates, config.limits)
          }),
      ...(request.updateExpressions === undefined ? {} : { updateExpressions: Object.freeze([...request.updateExpressions]) }),
      ...(request.goalSeekExpressions === undefined ? {} : { goalSeekExpressions: Object.freeze([...request.goalSeekExpressions]) }),
      ...(request.toolTest === undefined ? {} : { toolTest: Object.freeze([...request.toolTest]) }),
      ...(request.resize === undefined ? {} : { resize: Object.freeze({ ...request.resize }) }),
      ...(request.exportRange === undefined ? {} : { exportRange: Object.freeze({ ...request.exportRange }) }),
      ...(request.selection === undefined ? {} : { selection: Object.freeze(request.selection.kind === "all" ? { kind: "all" as const } :
        { kind: "ids" as const, ids: Object.freeze([...request.selection.ids]) }) }),
      ...(request.goalSeek === undefined
        ? {}
        : {
            goalSeek: Object.freeze(
              request.goalSeek.map((goal) =>
                Object.freeze({
                  ...goal,
                  target: Object.freeze({ ...goal.target }),
                  variable: Object.freeze({ ...goal.variable })
                })
              )
            )
          }),
      ...(request.exportOptions === undefined
        ? {}
        : { exportOptions: Object.freeze([...request.exportOptions]) }),
      ...(request.analysis === undefined
        ? {}
        : {
            analysis: Object.freeze({
              ...request.analysis,
              ...(request.analysis.toolOptions === undefined ? {} : { toolOptions: Object.freeze({
                ...request.analysis.toolOptions,
                properties: Object.freeze({ ...request.analysis.toolOptions.properties }),
                ...(request.analysis.toolOptions.data === undefined ? {} : { data: Object.freeze({ ...request.analysis.toolOptions.data }) }),
                ...(request.analysis.toolOptions.x === undefined ? {} : { x: request.analysis.toolOptions.x === null ? null : Object.freeze({ ...request.analysis.toolOptions.x }) }),
                ...(request.analysis.toolOptions.y === undefined ? {} : { y: request.analysis.toolOptions.y === null ? null : Object.freeze({ ...request.analysis.toolOptions.y }) })
              }) }),
              properties: Object.freeze(
                request.analysis.properties.map((property) => Object.freeze({ ...property }))
              )
            })
          })
    });
  }
  const engine: Engine = {
    limits: config.limits,
    listServices: registry.list,
    async readWorkbook(input, options, operation) {
      if (disposed) throw new SsconvertError("invalid-request", "ssconvert engine is disposed");
      operation.signal.throwIfAborted();
      input = Object.freeze({ ...input });
      options = Object.freeze({ ...options });
      return session(
        operation,
        async (context) =>
          (await read(input, options.importType, options.importEncoding, context)).book
      );
    },
    async writeWorkbook(book, destination, options, operation) {
      if (disposed) throw new SsconvertError("invalid-request", "ssconvert engine is disposed");
      operation.signal.throwIfAborted();
      destination = Object.freeze({ ...destination });
      const exportType = options.exportType;
      const suppliedOptions = options.exportOptions ?? [];
      bounded(suppliedOptions.length, config.limits.operations, "export options");
      const exportOptions = Object.freeze([...suppliedOptions]);
      return session(operation, (context) => {
        if (!books.has(book))
          throw new SsconvertError("invalid-request", "Workbook belongs to another engine");
        return write(
          book,
          destination,
          exportType,
          exportOptions,
          context,
          0
        );
      });
    },
    async convert(suppliedRequest, operation) {
      if (disposed) throw new SsconvertError("invalid-request", "ssconvert engine is disposed");
      operation.signal.throwIfAborted();
      const request = capture(suppliedRequest);
      return session(operation, async (context) => {
        if (request.verbose && request.exportType === undefined && !request.graphs && request.clipboard === undefined) {
          const codec = exporter(request.destination, request.exportType);
          await context.diagnostic!({ code: "exporter-selection", severity: "warning", message: `Using exporter ${codec.id}` });
          check(context);
        }
        requireCapabilities(request);
        const imported = await read(
          request.input,
          request.clipboard === undefined ? request.importType : undefined,
          request.importEncoding,
          context
        );
        if (!imported.book.sheets.length) throw new SsconvertError("io", `Loading ${resourceUri(request.input.kind === "resource" ? request.input.uri : request.input.filename ?? "(unspecified)", config.environment.cwd)} failed`);
        const sourceName = request.input.kind === "resource" ? request.input.uri : request.input.filename;
        const sourceUri = sourceName === undefined ? undefined : resourceUri(sourceName, config.environment.cwd);
        const loaded = await prepareWorkbookLoad(imported.book, config, context);
        check(context);
        const book = await applyConversionUpdates(loaded, request, config, context, () => check(context), sourceUri);
        if (request.clipboard !== undefined) {
          const range = request.exportRangeExpression === undefined ? request.exportRange : parseRangeExpression(request.exportRangeExpression, book, false, sourceUri);
          return saveConversion(book, request, context, imported.bytes, undefined, range);
        }
        const prepared = request.graphs ? undefined : await prepareExport(book, request.destination, request.exportType, request.exportOptions ?? [], context, request);
        const transformed = await runConversionTransforms(book, request, config, context, () => check(context), sourceUri);
        check(context);
        return saveConversion(transformed.book, request, context, imported.bytes, prepared, transformed.range);
      });
    },
    async merge(suppliedRequest, operation) {
      if (disposed) throw new SsconvertError("invalid-request", "ssconvert engine is disposed");
      operation.signal.throwIfAborted();
      const first = suppliedRequest.inputs[0];
      if (!first || suppliedRequest.inputs.length < 2) throw new SsconvertError("invalid-request", "At least two merge inputs are required.");
      const request = capture({ ...suppliedRequest, input: first }, suppliedRequest.inputs.length);
      const inputs = Object.freeze(suppliedRequest.inputs.map((input) => Object.freeze({ ...input })));
      return session(operation, async (context) => {
        if (request.verbose && request.exportType === undefined && !request.graphs)
          await context.diagnostic!({ code: "exporter-selection", severity: "warning", message: `Using exporter ${exporter(request.destination, request.exportType).id}` });
        requireCapabilities(request);
        // Native validates options/splitting on the fresh target before loading inputs.
        let book: Workbook = { sheets: [] };
        const prepared = request.graphs ? undefined : await prepareExport(book, request.destination, request.exportType, request.exportOptions ?? [], context, request);
        const imported: { input: Input; book: Workbook }[] = [];
        let inputBytes = 0;
        let importedCells = 0, importedSheets = 0;
        for (const input of inputs) {
          const result = await read(input, request.importType, request.importEncoding, context, config.limits.inputBytes - inputBytes,
            { ...config.limits, cells: config.limits.cells - importedCells, sheets: config.limits.sheets - importedSheets });
          inputBytes += result.bytes;
          if (result.book.sheets.length) {
            result.book = await prepareWorkbookLoad(result.book, config, context);
            importedSheets += result.book.sheets.length + (result.book.detachedSheets?.length ?? 0);
            for (const sheets of [result.book.sheets, result.book.detachedSheets ?? []])
              for (const sheet of sheets) importedCells += sheet.cells.length;
            imported.push({ input, book: result.book });
          }
        }
        for (const incoming of imported) {
          const filename = incoming.input.kind === "resource" ? incoming.input.uri : incoming.input.filename ?? "(unspecified)";
          await context.diagnostic!({ code: "merge", severity: "warning", message: `Adding sheets from ${resourceUri(filename, config.environment.cwd)}` });
          book = mergeWorkbookSheets(book, incoming.book, config.limits, context);
          check(context);
        }
        const transformed = await runConversionTransforms(book, request, config, context, () => check(context));
        check(context);
        return saveConversion(transformed.book, request, context, inputBytes, prepared, transformed.range);
      });
    },
    exportGraphs(request, operation) {
      return engine.convert({ input: request.input, destination: { kind: "resource", uri: request.graph.template },
        graphs: true, ...(request.graph.format === undefined ? {} : { exportType: request.graph.format }),
        ...(request.graph.options === undefined ? {} : { exportOptions: request.graph.options }) }, operation);
    },
    exportClipboard(request, operation) {
      return engine.convert({ ...request, clipboard: request.target, exportRange: request.range }, operation);
    },
    dispose() {
      disposed = true;
      return (disposal ??= (async () => {
        const outcomes = await Promise.allSettled([...active]);
        const failures = outcomes.filter(
          (outcome): outcome is PromiseRejectedResult => outcome.status === "rejected"
        );
        if (failures.length)
          throw new AggregateError(
            failures.map((outcome) => outcome.reason),
            "ssconvert disposal observed failed operations"
          );
      })());
    }
  };
  return engine;
}
