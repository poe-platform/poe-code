import { SsconvertError, type ByteSource, type CapabilityContext } from "./contracts.js";
import type { Workbook } from "./workbook.js";
import { recalculateWithDiagnostics } from "./formulas/diagnostics.js";
import { byteTextArg } from "./formulas/functions/common.js";
import { numericResult } from "./formulas/values.js";
import { snapshotRuntimeFunctions, type RuntimeFunctions } from "./formulas/runtime-functions.js";

/** Trusted host transport. poll returns a finite batch available now, not a live
 * stream that waits for EOF. No filesystem, pipe or network is acquired implicitly. */
export interface DatasourceTransport {
  poll(signal: AbortSignal): Promise<ByteSource>;
  close(): void | Promise<void>;
}
export interface DatasourceCapability {
  /** Register host acquisition cleanup through context.own before acquiring a
   * resource. Return undefined when no session can be opened (e.g. existing FIFO). */
  open(context: CapabilityContext): Promise<DatasourceTransport | undefined>;
}
export interface DatasourceSession {
  readonly runtimeFunctions: RuntimeFunctions;
  /** Process one bounded available batch and recalculate watched dependents. */
  poll(book: Workbook): Promise<Workbook>;
}

/** Invocation-owned port of sample_datasource; native OS timing is host-owned. */
export async function openDatasourceSession(capability: DatasourceCapability, context: CapabilityContext): Promise<DatasourceSession> {
  let transport: DatasourceTransport | undefined, closed = false, work = 0, bytesRead = 0;
  const values = new Map<string, number>(), watchers = new Map<string, Set<string>>();
  const line: number[] = [];
  let watcherCount = 0, linked = false, epoch = 0;
  const epochs = new WeakMap<Workbook, number>();
  const observed = new Map<string, { epoch: number; formula: string | undefined; tags: Set<string> }>();
  let blocked = false, polling = false;
  const tick = (amount = 1) => {
    context.signal.throwIfAborted();
    if (closed) throw new SsconvertError("invalid-request", "ssconvert datasource session is closed");
    work += amount;
    if (work > (context.limits.workbookWork ?? context.limits.inputBytes * 8))
      throw new SsconvertError("resource-limit", "ssconvert datasource work limit exceeded");
  };
  const release = async () => {
    closed = true;
    values.clear(); watchers.clear(); observed.clear(); watcherCount = 0; line.length = 0;
    const acquired = transport; transport = undefined;
    await acquired?.close();
  };
  context.own(release);
  try { transport = await capability.open(context); }
  catch {
    context.signal.throwIfAborted();
    throw new SsconvertError("io", "Could not open ssconvert datasource");
  }
  if (closed) { await release(); context.signal.throwIfAborted(); }
  tick();
  const hex = (bytes: readonly number[] | Uint8Array) => {
    let key = "";
    for (const byte of bytes) { tick(); if (byte === 0) break; key += byte.toString(16).padStart(2, "0"); }
    return key;
  };
  const runtimeFunctions = snapshotRuntimeFunctions({ ATL_LAST: { signature: "s", implementation(args, host) {
    tick();
    const key = hex(byteTextArg(args, 0, host));
    const cell = JSON.stringify([host.position.sheet, host.position.row, host.position.column]);
    let evaluation = epochs.get(host.book);
    if (evaluation === undefined) { evaluation = ++epoch; epochs.set(host.book, evaluation); }
    let previous = observed.get(cell);
    if (previous?.epoch !== evaluation) {
      for (const tag of previous?.tags ?? []) if (watchers.get(tag)?.delete(cell)) {
        watcherCount--;
        if (!watchers.get(tag)!.size) watchers.delete(tag);
      }
      const sheet = host.book.sheets.find(sheet => sheet.id === host.position.sheet);
      previous = { epoch: evaluation, formula: sheet && host.cell(sheet, host.position.row, host.position.column)?.formula, tags: new Set() };
      observed.set(cell, previous);
    }
    let cells = watchers.get(key);
    if (!cells) {
      if (watchers.size >= context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert datasource tag limit exceeded");
      cells = new Set(); watchers.set(key, cells);
    }
    if (!cells.has(cell)) {
      if (++watcherCount > context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert datasource watcher limit exceeded");
      cells.add(cell); previous!.tags.add(key);
    }
    return values.has(key) ? numericResult(values.get(key)!) : { kind: "error", value: "#N/A" };
  } } });
  const calculationContext: CapabilityContext = { ...context, runtimeFunctions: { ...context.runtimeFunctions, ...runtimeFunctions } };
  return Object.freeze({ runtimeFunctions, async poll(book: Workbook) {
    tick();
    if (polling) throw new SsconvertError("invalid-request", "ssconvert datasource poll is already running");
    polling = true;
    try {
      tick();
      // Remove links for deleted/edited expressions; evaluated cells rebuild their
      // tag links once per evaluation, including multiple ATL_LAST calls in a cell.
      const current = new Map<string, string | undefined>();
      for (const sheet of book.sheets) for (const cell of sheet.cells) {
        tick(); current.set(JSON.stringify([sheet.id, cell.row, cell.column]), cell.formula);
      }
      for (const [cell, entry] of observed) if (!current.has(cell) || current.get(cell) !== entry.formula) {
        tick();
        for (const tag of entry.tags) if (watchers.get(tag)?.delete(cell)) {
          watcherCount--;
          if (!watchers.get(tag)!.size) watchers.delete(tag);
        }
        observed.delete(cell);
      }
      book = await recalculateWithDiagnostics(book, calculationContext, !linked);
      linked = true;
      if (!transport) return book;
      let source: ByteSource;
      try { source = await transport.poll(context.signal); }
      catch {
        context.signal.throwIfAborted();
        throw new SsconvertError("io", "Could not poll ssconvert datasource");
      }
      tick();
      const changed = new Set<string>();
      try {
        for await (const supplied of source) {
          tick();
          if (!(supplied instanceof Uint8Array)) throw new SsconvertError("invalid-request", "Invalid ssconvert datasource byte chunk");
          bytesRead += supplied.byteLength;
          if (bytesRead > context.limits.inputBytes) throw new SsconvertError("resource-limit", "ssconvert datasource bytes limit exceeded");
          const chunk = new Uint8Array(supplied);
          for (const byte of chunk) {
            tick();
            if (blocked) continue;
            // strchr cannot see a newline past NUL; the native buffer stops progressing.
            if (byte === 0) { blocked = true; continue; }
            if (byte !== 10) { line.push(byte); continue; }
            const colon = line.indexOf(58);
            if (colon >= 0) {
              const key = hex(line.slice(0, colon));
              let text = "";
              for (let at = colon + 1; at < line.length; at++) { tick(); text += String.fromCharCode(line[at]!); }
              let at = 0;
              while (at < text.length && " \t\r\n\v\f".includes(text[at]!)) { tick(); at++; }
              const start = at;
              if (text[at] === "+" || text[at] === "-") at++;
              const special = text.slice(at, at + 3).toLowerCase();
              let digits = 0, nonzero = false;
              const digit = (character: string | undefined) => character !== undefined && character >= "0" && character <= "9";
              while (digit(text[at])) { tick(); nonzero ||= text[at] !== "0"; digits++; at++; }
              if (text[at] === ".") {
                at++;
                while (digit(text[at])) { tick(); nonzero ||= text[at] !== "0"; digits++; at++; }
              }
              const value = special === "inf" ? text[start] === "-" ? -Infinity : Infinity : special === "nan" ? NaN :
                digits ? Number.parseFloat(text.slice(start)) : undefined;
              // go_strtod rejects C99 hex; the decimal zero prefix is still consumed.
              // Overflow/underflow raises ERANGE; explicit inf/nan remains a valid feed.
              if (value !== undefined && (special === "inf" || special === "nan" || Number.isFinite(value) &&
                  (value === 0 ? !nonzero : Math.abs(value) >= 2 ** -1022))) {
                if (!values.has(key) && values.size >= context.limits.cells) throw new SsconvertError("resource-limit", "ssconvert datasource tag limit exceeded");
                values.set(key, value);
                for (const cell of watchers.get(key) ?? []) { tick(); changed.add(cell); }
              }
            }
            line.length = 0;
          }
        }
      } catch (error) {
        context.signal.throwIfAborted();
        if (error instanceof SsconvertError) throw error;
        throw new SsconvertError("io", "Could not read ssconvert datasource");
      }
      tick();
      if (!changed.size) return book;
      const dirty: Workbook = { ...book, sheets: book.sheets.map(sheet => ({ ...sheet, cells: sheet.cells.map(cell => {
        tick();
        return changed.has(JSON.stringify([sheet.id, cell.row, cell.column])) ? { ...cell, formulaDirty: true } : cell;
      }) })) };
      return await recalculateWithDiagnostics(dirty, calculationContext);
    } finally { polling = false; }
  } });
}
