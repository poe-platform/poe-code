import type { CsvkitContext, ByteSource } from "./contracts.js";
import type { MatchFileScope } from "./match-files.js";
import type { CommandDescriptor } from "./descriptor.js";
import { readCsvStream, writeCsvRow, type CsvDialect, type CsvRecord, type CsvWriteCell, type CsvCell } from "./csv.js";
import { CsvkitBlocked, CsvkitDiagnostic, CsvkitCleanupError, CsvkitOutputBudgetError, CsvkitWorkBudgetError } from "./errors.js";
import { fileException, warningText } from "./diagnostics/index.js";
import { sniff } from "./csv/sniffer.js";
import { LazyInput, virtualPath, pathExtension } from "./io/index.js";
import { resolveCodec } from "./codecs/python.js";
export { virtualPath } from "./io/index.js";

export type Settings = Readonly<Record<string, unknown>>;

/** One invocation owns counters, admitted iterators and output backpressure. */
export class Runtime {
  /** Side input/destinations belong to the invocation independently of stdout. */
  sideEffects = false;
  #input = 0;
  #inflated = 0;
  #codepoints = 0;
  #output = 0;
  #retained = 0;
  #work = 0;
  #rows = 0;
  #writtenRows = 0;
  #sniffWarning = false;
  #closed = false;
  readonly #iterators = new Map<AsyncIterator<Uint8Array>, () => Promise<void>>();
  #closing: Promise<void> | undefined;
  #stdinBytes: AsyncIterator<Uint8Array> | undefined;
  #stdinText: LazyInput | undefined;
  readonly #files = new Set<LazyInput>();
  readonly #abort = (): void => { void this.close().catch(() => {}); };
  constructor(readonly context: Omit<CsvkitContext, "argv">, readonly descriptor: CommandDescriptor, readonly options: Settings, readonly matchFiles?: MatchFileScope) {
    context.registerCleanup(this.close, "invocation");
    if (context.signal.aborted) this.#abort();
    else context.signal.addEventListener("abort", this.#abort, { once: true });
  }
  readonly close = (): Promise<void> => {
    this.#closed = true;
    this.context.signal.removeEventListener("abort", this.#abort);
    return this.#closing ??= Promise.allSettled([...this.#files].map(file => file.close()).concat([...this.#iterators.values()].map(close => close()))).then(results => {
      const failures = results.flatMap(result => result.status === "rejected" ? [result.reason] : []);
      if (failures.length) throw new CsvkitCleanupError(failures, "CSV stream cleanup failed");
    });
  };
  readonly step = (): void => {
    this.context.signal.throwIfAborted();
    if (this.#closed) throw new CsvkitBlocked("invocation already closed");
    if (++this.#work > this.context.limits.maxWork) throw new CsvkitWorkBudgetError();
  };
  retain(bytes: number): void {
    this.#retained += bytes;
    if (!Number.isSafeInteger(this.#retained) || this.#retained > this.context.limits.maxRetainedBytes) throw new CsvkitBlocked("retained byte budget exceeded");
  }
  async *#read(source: ByteSource, inflated = false): AsyncGenerator<Uint8Array> {
    let iterator: AsyncIterator<Uint8Array> | undefined = undefined;
    let accepting = true;
    let iteratorClosing: Promise<void> | undefined;
    const closeIterator = (): Promise<void> => {
      accepting = false;
      return iteratorClosing ??= Promise.resolve().then(async () => { await iterator?.return?.(); });
    };
    this.context.registerCleanup(closeIterator, this.sideEffects ? "invocation" : undefined);
    this.step(); if (!accepting) throw new CsvkitBlocked("input acquisition already closed");
    iterator = source[Symbol.asyncIterator]();
    this.#iterators.set(iterator, closeIterator);
    let readFailed = false;
    let readFailure: unknown;
    try {
      while (true) {
        this.step();
        const next = await iterator.next();
        this.step();
        if (next.done) break;
        if (inflated) {
          this.#inflated += next.value.byteLength;
          if (this.#inflated > this.context.limits.maxInflatedBytes) throw new CsvkitBlocked("inflated byte budget exceeded");
        } else {
          this.#input += next.value.byteLength;
          if (this.#input > this.context.limits.maxInputBytes) throw new CsvkitBlocked("input byte budget exceeded");
        }
        this.retain(64 + next.value.byteLength);
        yield Uint8Array.from(next.value);
      }
    } catch (failure) {
      readFailed = true;
      readFailure = failure;
    } finally {
      try { await (readFailed ? closeIterator().catch(() => {}) : closeIterator()); }
      finally { this.#iterators.delete(iterator); }
    }
    if (readFailed) throw readFailure;
  }
  /** Binary readers use the raw source; common text opening opts into suffix decoding. */
  async *bytes(path: string | null = this.options.input_path as string | null, commonText = false): AsyncGenerator<Uint8Array> {
    this.step();
    try {
      let source: ByteSource;
      if (!path || path === "-") {
        this.#stdinBytes ??= this.#read(this.context.stdin)[Symbol.asyncIterator]();
        const iterator = this.#stdinBytes;
        source = { [Symbol.asyncIterator]: () => ({ next: () => iterator.next() }) };
      }
      else {
        const resolved = virtualPath(this.context.cwd, path);
        const raw = this.context.fs.readStream ? this.context.fs.readStream(resolved, { signal: this.context.signal }) :
          (async function* (context: Omit<CsvkitContext, "argv">, maxBytes: number) { yield await context.fs.readFile(resolved, {
            signal: context.signal, ...(maxBytes === Infinity ? {} : { maxBytes })
          }); })(this.context, this.context.limits.maxInputBytes - this.#input);
        source = this.#read(raw);
        const extension = pathExtension(path);
        if (commonText && [".gz", ".bz2", ".xz", ".zst"].includes(extension)) {
          const compression = this.context.compression.find(provider => provider.extensions.includes(extension));
          if (compression) source = this.#read(compression.decode(source, this.context.signal, this.context.limits), true);
          // The frozen reference lacks optional zstandard: .zst is then plain text.
          else if (extension !== ".zst") throw new CsvkitBlocked(`compression capability ${extension}`);
        }
      }
      yield* source;
    }
    catch (failure) {
      this.context.signal.throwIfAborted();
      throw path && path !== "-" ? fileException(failure, path) : failure;
    }
  }
  /** Raw side-input reads share the invocation input budget and return owned bytes.
   * The caller chooses whether a missing path is a literal argument or an error. */
  async readFileBytes(path: string): Promise<Uint8Array> {
    this.step();
    const maxBytes = this.context.limits.maxInputBytes - this.#input;
    const bytes = await this.context.fs.readFile(virtualPath(this.context.cwd, path), {
      signal: this.context.signal, ...(maxBytes === Infinity ? {} : { maxBytes })
    });
    this.step();
    this.#input += bytes.byteLength;
    if (this.#input > this.context.limits.maxInputBytes) throw new CsvkitBlocked("input byte budget exceeded");
    this.retain(64 + bytes.byteLength);
    return Uint8Array.from(bytes);
  }
  async text(path: string | null = this.options.input_path as string | null, skipped = Number(this.options.skip_lines ?? 0)): Promise<string> {
    const file = this.input(path);
    try { return await file.read(skipped); }
    finally { if (path && path !== "-") await file.close(); }
  }
  input(path: string | null = this.options.input_path as string | null, opened = false): LazyInput {
    this.step();
    if ((!path || path === "-") && this.#stdinText) {
      this.#stdinText.assertOpen();
      if (!opened && this.#stdinText.readStarted)
        throw new CsvkitDiagnostic("UnsupportedOperation: It is not possible to set the encoding or newline of stream after the first read");
      return this.#stdinText;
    }
    const encoding = String(this.options.encoding ?? "utf-8-sig");
    const resolved = resolveCodec(this.context.codecs, encoding);
    const file = new LazyInput(path && path !== "-" ? path : "<stdin>", () => this.bytes(path, true), resolved.codec, resolved.encoding,
      this.context.signal, size => this.retain(size), text => {
        for (const ignoredChar of text) { this.step(); if (++this.#codepoints > this.context.limits.maxCodepoints) throw new CsvkitBlocked("codepoint budget exceeded"); }
      }, !path || path === "-");
    this.#files.add(file);
    if (!path || path === "-") this.#stdinText = file;
    return file;
  }
  records(path?: string | null, file?: LazyInput, skipped?: number, table?: boolean, recordLimit?: number): AsyncGenerator<CsvRecord>;
  records(path: string | null | undefined, file: LazyInput | undefined, skipped: number | undefined, table: boolean | undefined, recordLimit: number | undefined, preserveCells: true): AsyncGenerator<CsvRecord<CsvCell>>;
  async *records(path: string | null = this.options.input_path as string | null, file = this.input(path), skipped = Number(this.options.skip_lines ?? 0), table = false, recordLimit?: number, preserveCells = false): AsyncGenerator<CsvRecord<CsvCell>> {
    const options = this.options;
    let inferred: CsvDialect = {};
    // Applicability comes from the original executable's declared parser actions.
    const limit = table && this.descriptor.actions.some(action => action.dest === "sniff_limit") ? Number(options.sniff_limit) : 0;
    if (limit === -1 || limit > 0) {
      for (let count = 0; count < skipped; count++) if (await file.nextLine(false) === null) break;
      skipped = 0;
      const sample = await file.sniffSample(limit, this.context.sniffing?.maxSampleCharacters ?? Infinity, this.context.sniffing?.stream);
      const detected = sniff(sample, this.step);
      if (detected) inferred = detected;
      else if (!this.context.sniffing?.suppressWarnings && !this.#sniffWarning) {
        const warning = this.context.sniffing?.warning;
        if (!warning) throw new CsvkitBlocked("sniff failure warning deployment identity");
        await this.write(warningText({ ...warning, category: "RuntimeWarning", message: "Error sniffing CSV dialect: Could not determine delimiter" }), "stderr");
        this.#sniffWarning = true;
      }
    }
    const dialect: CsvDialect = {
      ...inferred,
      delimiter: options.tabs ? "\t" : String(options.delimiter || inferred.delimiter || ","),
      quotechar: String(options.quotechar ?? inferred.quotechar ?? '"'), quoting: Number(options.quoting ?? 0),
      doublequote: options.doublequote !== false, skipinitialspace: Boolean(options.skipinitialspace),
      fieldLimit: Number(options.field_size_limit ?? Infinity),
      fieldBudget: this.context.limits.maxFieldCharacters,
      columnBudget: this.context.limits.maxColumns,
      ...(options.escapechar === null || options.escapechar === undefined ? {} : { escapechar: String(options.escapechar) })
    };
    let failed = false;
    try {
      if (recordLimit === 0) {
        for (let count = 0; count < skipped; count++) if (await file.nextLine(false) === null) break;
        return;
      }
      let emitted = 0;
      for await (const record of readCsvStream(file.lines(skipped), dialect, this.step, this.#admitRow)) {
      // Parse first so upstream float conversion diagnostics remain observable.
      // String-only operations must explicitly qualify primitive input cells.
      const cells = record.cells;
      if (!cells.every(cell => { this.step(); return preserveCells || typeof cell === "string"; }))
        throw new CsvkitBlocked(`input quoting mode ${dialect.quoting} numeric/null operation cells`);
      yield { cells, line: record.line };
      if (recordLimit !== undefined && ++emitted >= recordLimit) return;
    } } catch (failure) { failed = true; throw failure; }
    finally { if (path && path !== "-") {
      if (failed) await file.close().catch(() => {});
      else await file.close();
    } }
  }
  readonly #admitRow = (): void => {
    this.step();
    if (++this.#rows > this.context.limits.maxRows) throw new CsvkitBlocked("row budget exceeded");
  };
  admitRecord(record: CsvRecord<CsvCell>): void {
    this.#admitRow();
    if (record.cells.length > this.context.limits.maxColumns) throw new CsvkitBlocked("column budget exceeded");
  }
  #admitOutput(text: string, precedingHighSurrogate = false): void {
    this.step();
    let size = 0;
    for (const char of text) {
      this.step();
      const code = char.codePointAt(0)!;
      // TextEncoder substitutes U+FFFD for an unpaired UTF-16 surrogate.
      size += precedingHighSurrogate && size === 0 && code >= 0xdc00 && code <= 0xdfff ? 1 :
        code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
      if (size > this.context.limits.maxOutputBytes - this.#output) throw new CsvkitOutputBudgetError();
    }
    this.#output += size;
  }
  async write(text: string, channel: "stdout" | "stderr" = "stdout"): Promise<void> {
    this.#admitOutput(text);
    const bytes = new TextEncoder().encode(text);
    await this.context[channel].write(bytes);
    this.step();
  }
  async writeSideFile(path: string, texts: Iterable<string>): Promise<void> {
    this.step();
    const destination = virtualPath(this.context.cwd, path);
    const encode = (text: string): Uint8Array => {
      this.#admitOutput(text);
      return new TextEncoder().encode(text);
    };
    if (!this.context.fs.openWriteFile) {
      let text = '';
      let precedingHighSurrogate = false;
      for (const chunk of texts) {
        this.#admitOutput(chunk, precedingHighSurrogate);
        this.retain(chunk.length * 2);
        text += chunk;
        if (chunk.length) {
          const last = chunk.charCodeAt(chunk.length - 1);
          precedingHighSurrogate = last >= 0xd800 && last <= 0xdbff;
        }
      }
      try { await this.context.fs.writeFile(destination, new TextEncoder().encode(text), { signal: this.context.signal }); }
      catch (failure) { this.context.signal.throwIfAborted(); throw fileException(failure, path); }
      this.step(); return;
    }
    let pending: ReturnType<NonNullable<typeof this.context.fs.openWriteFile>> | undefined;
    let writing: Promise<void> = Promise.resolve(); let closed = false; let closing: Promise<void> | undefined;
    const close = (): Promise<void> => {
      closed = true;
      return closing ??= Promise.resolve().then(async () => {
        let file;
        try { file = await pending; } catch { return; }
        await writing.catch(() => {}); await file?.close();
      });
    };
    this.context.registerCleanup(close, "invocation");
    let failed = false;
    try {
      this.step(); if (closed) throw new CsvkitBlocked('side-file destination already closed');
      pending = this.context.fs.openWriteFile(destination, { signal: this.context.signal });
      const file = await pending;
      this.step(); if (closed) throw new CsvkitBlocked('side-file destination already closed');
      // Encoding fragment boundaries must not change the joined string's bytes.
      // Hold only a terminal high surrogate until its successor is available.
      let highSurrogate = '';
      for (const text of texts) {
        this.step(); if (closed) throw new CsvkitBlocked('side-file destination already closed');
        if (!text.length) continue;
        let fragment = highSurrogate + text;
        const last = fragment.charCodeAt(fragment.length - 1);
        highSurrogate = last >= 0xd800 && last <= 0xdbff ? fragment.slice(-1) : '';
        if (highSurrogate) fragment = fragment.slice(0, -1);
        if (fragment.length) {
          writing = file.write(encode(fragment)); await writing; this.step();
        }
        if (closed) throw new CsvkitBlocked('side-file destination already closed');
      }
      if (highSurrogate) {
        this.step(); if (closed) throw new CsvkitBlocked('side-file destination already closed');
        writing = file.write(encode(highSurrogate)); await writing; this.step();
        if (closed) throw new CsvkitBlocked('side-file destination already closed');
      }
    } catch (failure) {
      failed = true; this.context.signal.throwIfAborted(); throw fileException(failure, path);
    } finally { if (failed || this.context.signal.aborted) await close().catch(() => {}); else await close(); }
  }
  async row(cells: readonly CsvWriteCell[], dialect: CsvDialect = {}, lineNumbers = Boolean(this.options.line_numbers)): Promise<void> {
    this.step();
    if (cells.length + (lineNumbers ? 1 : 0) > this.context.limits.maxColumns) throw new CsvkitBlocked("output column budget exceeded");
    const numbered = lineNumbers ? [this.#writtenRows === 0 ? "line_number" : this.#writtenRows, ...cells] : cells;
    const text = writeCsvRow(numbered, dialect, true, { step: this.step, admit: (bytes, codeUnits) => {
      if (!Number.isSafeInteger(bytes) || bytes > this.context.limits.maxOutputBytes - this.#output) throw new CsvkitOutputBudgetError();
      this.retain(codeUnits * 2);
      this.#output += bytes;
    } });
    await this.context.stdout.write(new TextEncoder().encode(text));
    this.step();
    this.#writtenRows++;
  }
  error(message: string): never { throw new CsvkitDiagnostic(this.descriptor.usage + this.descriptor.name + ": error: " + message, 2); }
  async prompt(): Promise<void> {
    if (this.context.terminal.stdinIsTTY && !this.options.input_path) await this.write("No input file or piped data provided. Waiting for standard input:\n", "stderr");
  }
}
