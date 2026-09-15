import { CancellationError, InvalidValueError, ResourceLimitError } from "./archive.js";

import type { DocumentXml } from "./package-xml.js";

export const documentXmlCache = Symbol("document-xml-cache");
interface InvocationXmlCache { entries?: Map<string, DocumentXml[]>; admitted?: WeakSet<Uint8Array> }

export const documentLimitDefaults = Object.freeze({
  compressedInput: 64 * 1024 * 1024,
  expandedPackage: 256 * 1024 * 1024,
  zipEntries: 10_000,
  xmlPartBytes: 32 * 1024 * 1024,
  xmlNodes: 2_000_000,
  xmlDepth: 256,
  embeddedMediaBytes: 64 * 1024 * 1024,
  retainedBytes: 512 * 1024 * 1024,
  serializedOutput: 256 * 1024 * 1024,
  batchOperations: 1_000,
  matches: 100_000,
  insertedNodes: 1_000_000,
  tableCells: 100_000,
  tableRows: 10_000,
  tableColumns: 1_024,
  diagnosticBytes: 64 * 1024,
  work: 512 * 1024 * 1024
});
export type DocumentLimitName = keyof typeof documentLimitDefaults;
export type DocumentLimits = Readonly<Record<DocumentLimitName, number>>;
const perDocument = new Set<DocumentLimitName>(["compressedInput", "expandedPackage", "zipEntries"]);
const zeroCapacity = new Set<DocumentLimitName>(["embeddedMediaBytes", "batchOperations", "matches", "insertedNodes"]);

function settings(values: Partial<DocumentLimits>, ceilings: DocumentLimits, lower: boolean): DocumentLimits {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new InvalidValueError("Expected document limits.");
  const result = { ...ceilings };
  for (const key of Reflect.ownKeys(values)) {
    if (typeof key !== "string" || !Object.hasOwn(ceilings, key))
      throw new InvalidValueError("Unknown document limit.");
    const name = key as DocumentLimitName;
    const descriptor = Object.getOwnPropertyDescriptor(values, key)!;
    const value: unknown = descriptor.value;
    if (!("value" in descriptor) || typeof value !== "number" || !Number.isSafeInteger(value) ||
      value < (zeroCapacity.has(name) ? 0 : 1) || (lower && value > ceilings[name]))
      throw new InvalidValueError("Document limits must be safe integers within host ceilings.");
    result[name] = value;
  }
  return Object.freeze(result);
}

/** Invocation reservations are conservative and never refunded; they are not RSS isolation. */
export class DocumentBudget {
  readonly limits: DocumentLimits;
  readonly signal: AbortSignal;
  readonly #turn: (signal: AbortSignal) => Promise<void>;
  #ledger: Partial<Record<DocumentLimitName, number>> = {};
  #document: Partial<Record<DocumentLimitName, number>> = {};
  #cooperation = { work: 0 };
  #xmlCache: InvocationXmlCache = {};

  constructor(host: Partial<DocumentLimits> = {}, signal = new AbortController().signal,
    yieldTurn: (signal: AbortSignal) => Promise<void> = async () => {
      await new Promise<void>(resolve => setTimeout(resolve, 0));
    }) {
    this.limits = settings(host, documentLimitDefaults, false);
    if (!(signal instanceof AbortSignal) || typeof yieldTurn !== "function")
      throw new InvalidValueError("Expected a cancellation signal and cooperative scheduler.");
    this.signal = signal;
    this.#turn = yieldTurn;
    Object.freeze(this);
  }

  get [documentXmlCache](): InvocationXmlCache { return this.#xmlCache; }

  get usage(): DocumentLimits {
    const usage: Record<DocumentLimitName, number> = { ...documentLimitDefaults };
    for (const key of Object.keys(usage) as DocumentLimitName[]) usage[key] = this.#ledger[key] ?? 0;
    return Object.freeze(usage);
  }

  lower(options: Partial<DocumentLimits>, signal = this.signal): DocumentBudget {
    const next = new DocumentBudget(settings(options, this.limits, true),
      signal === this.signal ? signal : AbortSignal.any([this.signal, signal]), this.#turn);
    next.#ledger = this.#ledger;
    next.#document = this.#document;
    next.#cooperation = this.#cooperation;
    next.#xmlCache = this.#xmlCache;
    return next;
  }

  document(): DocumentBudget {
    const next = this.lower({});
    next.#document = {};
    return next;
  }

  check(name: DocumentLimitName, amount: number): void {
    if (this.signal.aborted) throw new CancellationError("Document operation cancelled.");
    if (!Object.hasOwn(this.limits, name) || !Number.isSafeInteger(amount) || amount < 0)
      throw new InvalidValueError("Expected a nonnegative safe resource count.");
    if (amount > this.limits[name]) throw new ResourceLimitError(`Document ${name} limit exceeded.`);
  }

  charge(name: DocumentLimitName, amount: number): void {
    this.check(name, amount);
    const ledger = perDocument.has(name) ? this.#document : this.#ledger;
    const used = ledger[name] ?? 0;
    if (amount > this.limits[name] - used || amount > Number.MAX_SAFE_INTEGER - (this.#ledger[name] ?? 0))
      throw new ResourceLimitError(`Document ${name} limit exceeded.`);
    if (ledger !== this.#ledger) ledger[name] = used + amount;
    this.#ledger[name] = (this.#ledger[name] ?? 0) + amount;
  }

  table(rows: number, columns: number): void {
    this.check("tableRows", rows);
    this.check("tableColumns", columns);
    if (rows < 1 || columns < 1) throw new InvalidValueError("Table dimensions must be positive.");
    if (rows > Math.floor(this.limits.tableCells / columns))
      throw new ResourceLimitError("Document tableCells limit exceeded.");
    this.check("tableCells", rows * columns);
  }

  async checkpoint(work = 0): Promise<void> {
    this.charge("work", work);
    this.#cooperation.work += work;
    while (this.#cooperation.work >= 4096) {
      this.#cooperation.work -= 4096;
      await this.#turn(this.signal);
      this.check("work", 0);
    }
  }
}
