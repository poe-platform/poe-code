import {
  CsvBudget, CsvError, CsvParser, generatedHeaders, resolveColumns, serializeRow,
  type CsvDialect, type CsvLimits, type CsvRow, type CsvSelection
} from "safe-bash-csv-engine";
import type { CsvcutByteSource } from "./engine.js";

export interface CsvcutOptions extends CsvSelection {
  readonly headerless?: boolean;
  readonly names?: boolean;
  readonly deleteEmptyRows?: boolean;
  readonly lineNumbers?: boolean;
  readonly addBom?: boolean;
  readonly dialect?: CsvDialect;
}
export interface CsvcutRunOptions {
  readonly signal: AbortSignal;
  readonly limits?: Partial<CsvLimits>;
  /** Optional shared invocation ledger. Caller owns disposal; signal must match. */
  readonly budget?: CsvBudget;
  /** Register before acquiring input. The caller awaits cleanup on cancellation. */
  readonly registerCleanup?: (cleanup: () => Promise<void>) => void;
}
const bytePrototype = Object.getPrototypeOf(Uint8Array.prototype);
const kindOf = Object.getOwnPropertyDescriptor(bytePrototype, Symbol.toStringTag)!.get!;
const extent = Object.getOwnPropertyDescriptor(bytePrototype, "byteLength")!.get!;
const bufferOf = Object.getOwnPropertyDescriptor(bytePrototype, "buffer")!.get!;
const offsetOf = Object.getOwnPropertyDescriptor(bytePrototype, "byteOffset")!.get!;

async function finishInput(retire: () => Promise<void>, failed: boolean): Promise<void> {
  try { await retire(); }
  catch (error) { if (!failed) throw error; }
}

/** Bounded, buffered projection. Ordinary input is validated before output;
 * names reads only the header. No width enforcement or table inference.
 * The permissive reader is a versioned candidate, not complete Python parity.
 */
export function cutCsv(
  source: CsvcutByteSource,
  options: CsvcutOptions,
  configuration: CsvcutRunOptions
): AsyncGenerator<Uint8Array, void, unknown> {
  const supplied = Object.freeze({ ...options, dialect: Object.freeze({ ...options.dialect }) });
  const limits = Object.freeze({ ...configuration.limits });
  const parent = configuration.signal;
  const sharedBudget = configuration.budget;
  const controller = new AbortController();
  const signal = controller.signal;
  let accepting = true;
  let producer: AsyncIterator<Uint8Array> | undefined;
  let retirement: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const abort = (): void => controller.abort(parent.reason);
  const retire = (): Promise<void> => retirement ??= Promise.resolve().then(async () => { await producer?.return?.(); });
  const stream = (async function* (): AsyncGenerator<Uint8Array, void, unknown> {
    parent.throwIfAborted();
    if (!accepting) throw new CsvError("INPUT", "csvcut invocation closed");
    parent.addEventListener("abort", abort, { once: true });
    if (parent.aborted) abort();
    let budget: CsvBudget | undefined;
    let parser: CsvParser | undefined;
    let failed = false;
    try {
      if (sharedBudget && (sharedBudget.signal !== parent || configuration.limits !== undefined))
        throw new CsvError("ARGUMENT", "Shared budget requires the same signal and no separate limits");
      const b = budget = sharedBudget ?? new CsvBudget(limits, signal);
      const encode = (text: string): Uint8Array => {
        b.charge("work", text.length);
        let length = 0;
        for (const char of text) {
          const code = char.codePointAt(0)!;
          length += code <= 0x7f ? 1 : code <= 0x7ff ? 2 : code <= 0xffff ? 3 : 4;
        }
        b.charge("outputBytes", length);
        b.charge("retainedBytes", length + 32);
        return new TextEncoder().encode(text);
      };
      for (const value of [...Object.values(supplied), ...Object.values(supplied.dialect)]) {
        if (typeof value !== "string") continue;
        b.charge("argumentBytes", value.length * 3);
        b.text(value);
        b.charge("work", value.length);
      }
      // Explicit BOM is the sole output permitted before validation.
      if (supplied.addBom) yield encode("\ufeff");
      if (supplied.names && supplied.headerless)
        throw new CsvError("INPUT", "RequiredHeaderError: You cannot use --no-header-row with the -n or --names options.");
      const dialect: CsvDialect = { ...supplied.dialect, profile: supplied.dialect.profile ?? "utf8-sig-permissive-v1" };
      if (Number.isSafeInteger(dialect.skipLines) && dialect.skipLines! < 0) dialect.skipLines = 0;
      parser = new CsvParser(dialect, b);
      const rows: CsvRow[] = [];
      const retain = (incoming: readonly CsvRow[]): void => {
        for (const row of incoming) {
          b.charge("work", 1);
          b.charge("retainedBytes", 8);
          rows.push(row);
        }
      };
      producer = source(signal)[Symbol.asyncIterator]();
      const next = producer.next;
      while (!supplied.names || rows.length === 0) {
        signal.throwIfAborted();
        b.charge("work", 1);
        const chunk = await next.call(producer);
        signal.throwIfAborted();
        if (chunk.done) { retain(parser.end()); break; }
        let length: number;
        let bytes: Uint8Array;
        b.charge("retainedBytes", 32);
        try {
          if (kindOf.call(chunk.value) !== "Uint8Array")
            throw new CsvError("INPUT", "Invalid CSV byte chunk");
          length = extent.call(chunk.value) as number;
          // A borrowed view validates detached storage, including zero-length
          // chunks, without trusting producer properties or copying its bytes.
          bytes = new Uint8Array(
            bufferOf.call(chunk.value) as ArrayBuffer,
            offsetOf.call(chunk.value) as number,
            length
          );
        } catch {
          throw new CsvError("INPUT", "Invalid CSV byte chunk");
        }
        if (length > b.limits.inputBytes - b.accounting.inputBytes)
          throw new CsvError("LIMIT", "inputBytes limit exceeded");
        // Parse synchronously before producer advancement; never retain its views.
        const step = supplied.names ? 1 : 4096;
        for (let offset = 0; offset < length; offset += step) {
          retain(parser.push(bytes.subarray(offset, Math.min(offset + step, length))));
          if (supplied.names && rows.length) {
            // Input counts delivered bytes, including the suffix deliberately
            // left undecoded by names mode. Producer storage remains borrowed.
            b.charge("inputBytes", length - offset - 1);
            break;
          }
        }
      }
      await retire();
      const first = rows[0];
      if (supplied.names && !first) throw new CsvError("INPUT", "StopIteration: ");
      const headers = supplied.headerless ? generatedHeaders(first?.cells.length ?? 0, b) : first?.cells ?? [];
      const output: Uint8Array[] = [];
      const put = (text: string): void => { b.charge("retainedBytes", 8); output.push(encode(text)); };
      if (supplied.names) {
        for (let i = 0; i < headers.length; i++) {
          b.charge("work", headers[i]!.length + 1);
          b.charge("retainedBytes", headers[i]!.length * 2 + 64);
          put(`${String(i + (supplied.zero ? 0 : 1)).padStart(3, " ")}: ${headers[i]}\n`);
        }
      } else {
        const columns = resolveColumns(supplied, headers, b);
        const project = (cells: readonly string[]): string[] => {
          const projected: string[] = [];
          for (const index of columns) {
            b.charge("scannedCells", 1);
            b.charge("work", 1);
            b.charge("retainedBytes", 8);
            projected.push(cells[index] ?? "");
          }
          return projected;
        };
        const heading = project(headers);
        if (supplied.lineNumbers) { b.charge("retainedBytes", 32); heading.unshift("line_number"); }
        put(serializeRow(heading, b));
        let number = 0;
        for (let i = supplied.headerless ? 0 : 1; i < rows.length; i++) {
          b.charge("work", 1);
          const cells = project(rows[i]!.cells);
          let empty = true;
          for (const cell of cells) { b.charge("work", 1); if (cell !== "") empty = false; }
          if (supplied.deleteEmptyRows && empty) continue;
          if (supplied.lineNumbers) { b.charge("retainedBytes", 64); cells.unshift(String(++number)); }
          put(serializeRow(cells, b));
        }
      }
      for (const bytes of output) { signal.throwIfAborted(); yield bytes; }
    } catch (error) {
      failed = true;
      signal.throwIfAborted();
      throw error;
    } finally {
      try { await finishInput(retire, failed); }
      finally {
        accepting = false;
        parser?.dispose();
        if (!sharedBudget) budget?.dispose();
        parent.removeEventListener("abort", abort);
      }
    }
  })();
  configuration.registerCleanup?.(() => {
    if (closing) return closing;
    accepting = false;
    controller.abort(new CsvError("INPUT", "csvcut invocation closed"));
    closing = Promise.resolve().then(async () => { await stream.return(); });
    return closing;
  });
  return stream;
}
