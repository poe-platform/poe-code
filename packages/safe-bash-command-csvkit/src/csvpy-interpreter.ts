import type { InterpreterProvider, InterpreterSession } from "./contracts.js";
import { CsvkitBlocked, CsvkitDiagnostic } from "./errors.js";
import type { TypedTable } from "./table/index.js";
import { rawReaderLibrary, readerLibrary, exceptionsLibrary } from "./python/readers.js";

interface Value { readonly kind: string; readonly primitive: string | boolean | bigint | number | null }
interface Namespace { get(name: string): Value | undefined; set(name: string, value: Value): void; delete(name: string): boolean; names(): readonly string[] }
type Result = { readonly status: "ok"; readonly value?: Value } | { readonly status: "exception"; readonly exception: Value } | { readonly status: "diagnostic"; readonly diagnostic: { readonly name: string; readonly message: string } } | { readonly status: "terminated"; readonly message: string };
/** Structural maintained PythonSession boundary; host constructs a legitimate interpreter. */
export interface CsvpyPythonSession {
  readonly globals: Namespace;
  readonly usage: { readonly steps: number };
  value(value: string | boolean | bigint | number | null): Value;
  list(values: readonly Value[]): Value;
  dictionary(entries: readonly (readonly [Value, Value])[]): Value;
  callable(callback: (args: readonly Value[]) => Value): Value;
  registerModule(name: string, namespace: Namespace): Value;
  registerModuleAlias(name: string, module: Value): Value;
  createNamespace(): Namespace;
  exec(source: string, options?: { readonly globals?: Namespace; readonly filename?: string }): Result;
  interactive(source: string, options?: { readonly globals?: Namespace; readonly filename?: string }): Result | { readonly status: "incomplete" };
  eval(source: string, options?: { readonly globals?: Namespace; readonly filename?: string }): Result;
  close(): void;
}
export interface CsvpyInterpreterOptions {
  readonly createSession: (options: { readonly signal: AbortSignal; readonly output: { write(text: string): void; flush(): void } }) => CsvpyPythonSession;
  readonly terminal: {
    /** Includes newline, null at EOF. Borrowed terminal; adapter never closes it. */
    readLine(signal: AbortSignal): Promise<string | null>;
  };
  /** Explicit qualified Agate object library; never replaced with a plain JS/tuple table. */
  readonly createTable?: (session: CsvpyPythonSession, table: TypedTable, settings: Readonly<Record<string, unknown>>, signal: AbortSignal) => Promise<Value>;
}

/** Scoped Python console profile. IPython and unqualified library operations are explicit gaps. */
export function createCsvpyInterpreter(options: CsvpyInterpreterOptions): InterpreterProvider {
  return {
    modes: ["reader", "dict", "agate"],
    load: async () => { throw new CsvkitBlocked("csvpy requires JavaScript conversion"); },
    loadConverted: async (input, signal, work): Promise<InterpreterSession> => {
      let pending = "";
      let session: CsvpyPythonSession | undefined;
      let closing: Promise<void> | undefined;
      let accepting = true;
      const retirement = new AbortController();
      const guestSignal = AbortSignal.any([signal, retirement.signal]);
      const terminalReads = new Set<Promise<string | null>>();
      let bridgeFailed = false;
      let bridgeFailure: unknown;
      const close = (): Promise<void> => {
        accepting = false;
        return closing ??= Promise.resolve().then(async () => {
          retirement.abort(new CsvkitBlocked("csvpy session closed"));
          await Promise.allSettled([...terminalReads]);
          session?.close();
        });
      };
      try {
        signal.throwIfAborted();
        session = options.createSession({ signal: guestSignal, output: { write: text => {
          try { input.retainOutput(text.length * 4); pending += text; }
          catch (failure) { bridgeFailed = true; bridgeFailure = failure; throw failure; }
        }, flush: () => {} } });
        const guest = session;
        let steps = guest.usage.steps;
        const account = (): void => { if (bridgeFailed) throw bridgeFailure; const next = guest.usage.steps; work.consume(next - steps); steps = next; };
        const requireOk = (result: Result): void => { account(); if (result.status !== "ok") throw new CsvkitBlocked(`csvpy Python library initialization ${result.status}`); };
        const exceptionNamespace = guest.createNamespace();
        const csv = guest.createNamespace();
        csv.set("__name__", guest.value("_csv"));
        requireOk(guest.exec(rawReaderLibrary, { globals: csv }));
        for (const [name, value] of Object.entries({ QUOTE_MINIMAL: 0, QUOTE_ALL: 1, QUOTE_NONNUMERIC: 2, QUOTE_NONE: 3, QUOTE_STRINGS: 4, QUOTE_NOTNULL: 5 })) csv.set(name, guest.value(BigInt(value)));
        guest.registerModule("_csv", csv);
        const stdlibCsv = guest.createNamespace();
        for (const name of ["Error", "QUOTE_MINIMAL", "QUOTE_ALL", "QUOTE_NONNUMERIC", "QUOTE_NONE", "QUOTE_STRINGS", "QUOTE_NOTNULL"]) stdlibCsv.set(name, csv.get(name)!);
        const csvModule = guest.registerModule("csv", stdlibCsv);
        const exceptions = guest.createNamespace();
        exceptions.set("__name__", guest.value("agate.exceptions"));
        requireOk(guest.exec(exceptionsLibrary, { globals: exceptions }));
        const library = guest.createNamespace();
        library.set("__name__", guest.value("agate.csv_py3"));
        library.set("_CSVReader", csv.get("_CSVReader")!);
        library.set("_CSVError", csv.get("Error")!);
        library.set("csv", csvModule);
        library.set("POSSIBLE_DELIMITERS", guest.list([",", "\t", ";", " ", ":", "|"].map(value => guest.value(value))));
        library.set("FieldSizeLimitError", exceptions.get("FieldSizeLimitError")!);
        const fieldLimit = Number(input.settings.field_size_limit ?? Infinity);
        library.set("_field_limit", guest.value(Number.isFinite(fieldLimit) ? BigInt(fieldLimit) : fieldLimit));
        requireOk(guest.exec(readerLibrary, { globals: library }));
        requireOk(guest.exec("def reader(*args,**kwargs):return Reader(*args,**kwargs)", { globals: library }));
        const agate = guest.createNamespace();
        agate.set("__path__", guest.list([]));
        const readerModule = guest.registerModule("agate.csv_py3", library);
        guest.registerModuleAlias("agate.csv", readerModule);
        agate.set("csv", readerModule);
        agate.set("csv_py3", readerModule);
        agate.set("exceptions", guest.registerModule("agate.exceptions", exceptions));
        for (const name of ["DataTypeError", "UnsupportedAggregationError", "CastError", "FieldSizeLimitError"]) agate.set(name, exceptions.get(name)!);
        const config = guest.createNamespace();
        config.set("_options", guest.dictionary([
          [guest.value("number_truncation_chars"), guest.value(input.settings.no_number_ellipsis ? "" : "…")],
          [guest.value("default_locale"), guest.value("en_US_POSIX")],
          ...Object.entries({ horizontal_line_char: "-", vertical_line_char: "|", bar_char: "░", printable_bar_char: ":", zero_line_char: "▓", printable_zero_line_char: "|", tick_char: "+", ellipsis_chars: "...", text_truncation_chars: "..." }).map(([key, value]) => [guest.value(key), guest.value(value)] as const)
        ]));
        requireOk(guest.exec("def get_option(key):return _options[key]\ndef set_option(key,value):_options[key]=value\ndef set_options(options):_options.update(options)", { globals: config }));
        agate.set("config", guest.registerModule("agate.config", config));
        for (const name of ["get_option", "set_option", "set_options"]) agate.set(name, config.get(name)!);
        guest.registerModule("agate", agate);
        if (input.mode === "agate") {
          const table = await input.table();
          if (!options.createTable) throw new CsvkitBlocked("csvpy Agate Table object library");
          guest.globals.set("table", await options.createTable(guest, table, input.settings, signal));
          signal.throwIfAborted();
        } else {
          if (input.mode === "dict" && input.settings.no_header_row) throw new CsvkitDiagnostic("TypeError: 'header' is an invalid keyword argument for this function");
          const reader = await input.reader();
          let lineNumber = 0;
          guest.globals.set("_read", guest.callable(() => {
            try {
              work.consume();
              const next = reader.next();
              if (next.done) return guest.list([guest.value("end")]);
              lineNumber = next.value.line;
              return guest.list([guest.value("row"), guest.list(next.value.cells.map(cell => guest.value(cell))), guest.value(BigInt(next.value.line))]);
            } catch (failure) {
              if (!(failure instanceof CsvkitDiagnostic) || failure instanceof CsvkitBlocked) { bridgeFailed = true; bridgeFailure = failure; throw failure; }
              const separator = failure.message.indexOf(": ");
              const fieldError = failure.message.startsWith("FieldSizeLimitError:");
              if (fieldError) {
                const start = failure.message.indexOf("characters on line ") + "characters on line ".length;
                const end = failure.message.indexOf(".", start);
                const parsed = Number(failure.message.slice(start, end));
                if (Number.isSafeInteger(parsed) && parsed > 0) lineNumber = parsed;
              }
              const message = fieldError ? `field larger than field limit (${fieldLimit})` : separator < 0 ? failure.message : failure.message.slice(separator + 2);
              return guest.list([guest.value(fieldError ? "field-error" : failure.message.startsWith("ValueError:") ? "value-error" : "error"), guest.value(message), guest.value(BigInt(lineNumber))]);
            }
          }));
          guest.globals.set("_Reader", library.get(input.mode === "dict" ? "DictReader" : "Reader")!);
          const settings = input.settings;
          guest.globals.set("_Dialect", csv.get("Dialect")!);
          guest.globals.set("_dialect_values", guest.list([
            guest.value(settings.tabs ? "\t" : String(settings.delimiter ?? ",")), guest.value(String(settings.quotechar ?? '"')),
            guest.value(settings.escapechar === undefined || settings.escapechar === null ? null : String(settings.escapechar)),
            guest.value(BigInt(Number(settings.quoting ?? 0))), guest.value(settings.doublequote !== false), guest.value(Boolean(settings.skipinitialspace))
          ]));
          requireOk(guest.exec("reader=_Reader(_read,_Dialect(_dialect_values))\ndel _read,_Reader,_Dialect,_dialect_values"));
          if (input.mode === "reader") {
            guest.globals.set("_header", guest.value(!input.settings.no_header_row));
            requireOk(guest.exec("reader.header=_header\nreader.line_numbers=False\ndel _header"));
          }
        }
        account();
        return {
          profile: "safe-python-scoped-console-v1",
          close,
          interact: async (banner, interactionSignal) => {
            const terminalSignal = AbortSignal.any([guestSignal, interactionSignal]);
            const write = async (text: string, channel: "stdout" | "stderr"): Promise<void> => { interactionSignal.throwIfAborted(); await input.write(text, channel); interactionSignal.throwIfAborted(); };
            const flushOutput = async (): Promise<void> => {
              const output = pending;
              pending = "";
              if (output) await write(output, "stdout");
            };
            await write(banner + "\n", "stderr");
            let buffer = "";
            while (true) {
              work.consume();
              await write(buffer ? "... " : ">>> ", "stdout");
              if (!accepting) throw new CsvkitBlocked("csvpy session closed");
              const pendingRead = options.terminal.readLine(terminalSignal);
              terminalReads.add(pendingRead);
              let line: string | null;
              try { line = await pendingRead; }
              finally { terminalReads.delete(pendingRead); }
              interactionSignal.throwIfAborted();
              if (!accepting) throw new CsvkitBlocked("csvpy session closed");
              if (line === null) { await write("\nnow exiting InteractiveConsole...\n", "stderr"); break; }
              let sourceLine = line.endsWith("\n") ? line.slice(0, -1) : line;
              if (sourceLine.endsWith("\r")) sourceLine = sourceLine.slice(0, -1);
              buffer += (buffer ? "\n" : "") + sourceLine;
              const result = guest.interactive(buffer, { filename: "<console>" });
              if (bridgeFailed) throw bridgeFailure;
              if (result.status === "incomplete") { account(); continue; }
              account();
              await flushOutput();
              if (result.status === "exception") {
                exceptionNamespace.set("_csvpy_error", result.exception);
                const exit = guest.eval("isinstance(_csvpy_error,SystemExit)", { globals: exceptionNamespace });
                if (exit.status === "ok" && exit.value?.primitive === true) {
                  const code = guest.eval("_csvpy_error.code", { globals: exceptionNamespace });
                  if (code.status !== "ok" || !code.value) throw new CsvkitBlocked("csvpy SystemExit code");
                  account();
                  await flushOutput();
                  if (code.value.kind === "none") return 0;
                  if (code.value.kind === "int" || code.value.kind === "bool") return Number(code.value.primitive);
                  const display = guest.eval("str(_csvpy_error.code)", { globals: exceptionNamespace });
                  if (display.status !== "ok" || !display.value) throw new CsvkitBlocked("csvpy SystemExit display");
                  account(); await flushOutput(); await write(String(display.value.primitive) + "\n", "stderr"); return 1;
                }
                const message = guest.eval("str(_csvpy_error)", { globals: exceptionNamespace });
                account();
                if (message.status === "exception") exceptionNamespace.set("_csvpy_message", guest.value("<exception str() failed>"));
                else if (message.status === "ok" && message.value) exceptionNamespace.set("_csvpy_message", message.value);
                else throw new CsvkitBlocked("csvpy exception message formatting");
                const detail = guest.eval("type(_csvpy_error).__name__ + (': ' + _csvpy_message if _csvpy_message else '')", { globals: exceptionNamespace });
                if (detail.status !== "ok" || !detail.value) throw new CsvkitBlocked("csvpy exception formatting");
                account();
                await flushOutput();
                await write("Traceback (most recent call last):\n  File \"<console>\", line 1, in <module>\n" + String(detail.value.primitive) + "\n", "stderr");
                exceptionNamespace.delete("_csvpy_error");
                exceptionNamespace.delete("_csvpy_message");
              } else if (result.status === "diagnostic") await write(result.diagnostic.name + ": " + result.diagnostic.message + "\n", "stderr");
              else if (result.status === "terminated") throw new CsvkitBlocked("csvpy interpreter terminated: " + result.message);
              account();
              await flushOutput();
              buffer = "";
            }
          }
        };
      } catch (failure) { await close(); throw failure; }
    }
  };
}
