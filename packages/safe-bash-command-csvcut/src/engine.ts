import { CsvBudget, CsvParser, type CsvDialect, type CsvLimits, type CsvRow } from "safe-bash-csv-engine";

export interface CsvcutEngineOptions {
  readonly signal: AbortSignal;
  readonly limits?: Partial<CsvLimits>;
  readonly dialect?: CsvDialect;
}
/** Explicit caller capability. Pending reads and retirement must honor signal.
 * Chunks may be reused after next() resolves; parsing retains no producer bytes.
 */
export type CsvcutByteSource = (signal: AbortSignal) => AsyncIterable<Uint8Array>;

async function retireProducer(producer: AsyncIterator<Uint8Array> | undefined, failed: boolean): Promise<void> {
  try {
    await producer?.return?.();
  } catch (error) {
    if (!failed) throw error;
  }
}

/** Original record engine only: no command dispatch, row-width checks or inference.
 * Default strict-v1 intentionally rejects input Python's permissive reader accepts.
 * Callers select permissive-v1 explicitly when evaluating release controls.
 */
export async function* parseCsvRecords(
  source: CsvcutByteSource,
  options: CsvcutEngineOptions
): AsyncGenerator<CsvRow, void, unknown> {
  const { signal } = options;
  const budget = new CsvBudget(options.limits ?? {}, signal);
  let parser: CsvParser | undefined;
  let producer: AsyncIterator<Uint8Array> | undefined;
  let failed = false;
  try {
    parser = new CsvParser({ ...options.dialect, profile: options.dialect?.profile ?? "utf8-sig-strict-v1" }, budget);
    producer = source(signal)[Symbol.asyncIterator]();
    const next = producer.next;
    while (true) {
      signal.throwIfAborted();
      const chunk = await next.call(producer);
      if (chunk.done) break;
      for (const row of parser.push(chunk.value)) {
        signal.throwIfAborted();
        yield row;
      }
    }
    for (const row of parser.end()) {
      signal.throwIfAborted();
      yield row;
    }
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await retireProducer(producer, failed);
    } finally {
      parser?.dispose();
      budget.dispose();
    }
  }
}
