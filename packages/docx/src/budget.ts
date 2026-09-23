import { CancellationError, InvalidValueError, ResourceLimitError } from "./archive.js";
import { yieldEventLoop } from "@poe-code/office-package";

import type { DocumentXml, XmlAttribute, XmlContent, XmlElement } from "./package-xml.js";
import type { CompatibilityBranch, CompatibilityContent } from "./compatibility.js";

/** Internal reservation identity check; exposes no mutable ledger. */
export const budgetSharesReservations = Symbol("budget-shares-reservations");

/** Internal cooperative turn for work the XML parser has already reserved. */
export const reservedWorkTurn = Symbol("reserved-work-turn");

export const documentXmlCache = Symbol("document-xml-cache");
interface CachedDocumentXml {
  readonly source: Uint8Array;
  readonly document: DocumentXml;
  readonly maxNodes: number;
  readonly maxBytes: number;
  readonly elements: number;
  readonly parseCost: Readonly<Pick<DocumentLimits, "xmlNodes" | "work" | "retainedBytes">>;
  readonly replay?: Readonly<Pick<DocumentLimits, "xmlNodes" | "work" | "retainedBytes">>;
}
interface CachedCompatibility {
  readonly content: readonly CompatibilityContent[];
  readonly branches: readonly CompatibilityBranch[];
  readonly containers: readonly XmlElement[];
  readonly editable: Set<XmlContent | XmlAttribute>;
  readonly work: number;
  readonly retainedBytes: number;
}
interface InvocationXmlCache {
  entries?: Map<string, CachedDocumentXml[]>;
  admitted?: WeakSet<Uint8Array>;
  staged?: WeakSet<Uint8Array>;
  immutableRoots?: WeakSet<XmlElement>;
  compatibility?: WeakMap<XmlElement, Map<string, CachedCompatibility>>;
}

export const documentLimitDefaults = Object.freeze({
  compressedInput: Infinity,
  expandedPackage: Infinity,
  zipEntries: Infinity,
  xmlPartBytes: Infinity,
  xmlNodes: Infinity,
  xmlDepth: Infinity,
  embeddedMediaBytes: Infinity,
  retainedBytes: Infinity,
  serializedOutput: Infinity,
  batchOperations: Infinity,
  matches: Infinity,
  insertedNodes: Infinity,
  tableCells: Infinity,
  tableRows: Infinity,
  tableColumns: Infinity,
  diagnosticBytes: Infinity,
  work: Infinity
});
export type DocumentLimitName = keyof typeof documentLimitDefaults;
export type DocumentLimits = Readonly<Record<DocumentLimitName, number>>;
const perDocument = new Set<DocumentLimitName>(["compressedInput", "expandedPackage", "zipEntries"]);
const zeroCapacity = new Set<DocumentLimitName>(["embeddedMediaBytes", "batchOperations", "matches", "insertedNodes"]);

function settings(values: Partial<DocumentLimits>, ceilings: DocumentLimits): DocumentLimits {
  if (!values || typeof values !== "object" || Array.isArray(values))
    throw new InvalidValueError("Expected document limits.");
  const result = { ...ceilings };
  for (const key of Reflect.ownKeys(values)) {
    if (typeof key !== "string" || !Object.hasOwn(ceilings, key))
      throw new InvalidValueError("Unknown document limit.");
    const name = key as DocumentLimitName;
    const descriptor = Object.getOwnPropertyDescriptor(values, key)!;
    const value: unknown = descriptor.value;
    if (!("value" in descriptor) || typeof value !== "number" || (value !== Infinity && !Number.isSafeInteger(value)) ||
      value < (zeroCapacity.has(name) ? 0 : 1))
      throw new InvalidValueError("Document limits must be nonnegative safe integers or unlimited.");
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
    yieldTurn: (signal: AbortSignal) => Promise<void> = yieldEventLoop) {
    this.limits = settings(host, documentLimitDefaults);
    if (!(signal instanceof AbortSignal) || typeof yieldTurn !== "function")
      throw new InvalidValueError("Expected a cancellation signal and cooperative scheduler.");
    this.signal = signal;
    this.#turn = yieldTurn;
    Object.freeze(this);
  }

  [budgetSharesReservations](other: DocumentBudget): boolean { return other instanceof DocumentBudget && this.#ledger === other.#ledger; }

  get [documentXmlCache](): InvocationXmlCache { return this.#xmlCache; }

  get usage(): DocumentLimits {
    const usage: Record<DocumentLimitName, number> = { ...documentLimitDefaults };
    for (const key of Object.keys(usage) as DocumentLimitName[]) usage[key] = this.#ledger[key] ?? 0;
    return Object.freeze(usage);
  }

  lower(options: Partial<DocumentLimits>, signal = this.signal): DocumentBudget {
    const next = new DocumentBudget(settings(options, this.limits),
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
    const pending = this[reservedWorkTurn](work);
    if (pending) await pending;
  }

  [reservedWorkTurn](work: number): Promise<void> | undefined {
    this.#cooperation.work += work;
    if (this.#cooperation.work < 4096) return undefined;
    return this.#yieldReservedWork();
  }

  async #yieldReservedWork(): Promise<void> {
    while (this.#cooperation.work >= 4096) {
      this.#cooperation.work -= 4096;
      await this.#turn(this.signal);
      this.check("work", 0);
    }
  }
}
