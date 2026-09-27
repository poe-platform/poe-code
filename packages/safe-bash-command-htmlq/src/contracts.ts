export interface HtmlLimits {
  inputBytes: number;
  decodedBytes: number;
  retainedBytes: number;
  nodes: number;
  attributes: number;
  depth: number;
  tokenBytes: number;
  work: number;
  outputBytes: number;
}
export interface HtmlOptions {
  limits: HtmlLimits;
  signal: AbortSignal;
}
export type HtmlErrorCode =
  | "E_SELECTOR"
  | "E_ARGUMENT"
  | "E_LIMIT"
  | "E_CANCELLED"
  | "E_MUTATED"
  | "E_UNSUPPORTED"
  | "E_OWNERSHIP";
export class HtmlError extends Error {
  constructor(
    readonly code: HtmlErrorCode,
    message: string,
    readonly offset = 0,
    readonly resource?: keyof HtmlLimits
  ) {
    super(message);
    this.name = "HtmlError";
  }
}
export type HtmlNamespace = "html" | "svg" | "mathml";
export interface HtmlAttribute {
  name: string;
  value: string;
  namespace: "none" | "xml" | "xmlns" | "xlink";
}
export interface HtmlNode {
  readonly kind: "document" | "fragment" | "element" | "text" | "comment" | "doctype";
  readonly name: string;
  readonly data: string;
  readonly namespace: HtmlNamespace;
  readonly attributes: readonly Readonly<HtmlAttribute>[];
  readonly children: readonly HtmlNode[];
  readonly parent: HtmlNode | null;
  readonly previousSibling: HtmlNode | null;
  readonly nextSibling: HtmlNode | null;
  readonly templateContents?: HtmlNode;
}
/** Internal mutable storage; never returned to consumers. */
export interface MutableHtmlNode {
  kind: HtmlNode["kind"];
  name: string;
  data: string;
  namespace: HtmlNamespace;
  attributes: HtmlAttribute[];
  children: MutableHtmlNode[];
  parent: MutableHtmlNode | null;
  previousSibling: MutableHtmlNode | null;
  nextSibling: MutableHtmlNode | null;
  templateContents?: MutableHtmlNode;
}

export const htmlqBaseline = Object.freeze({
  commit: "bfcb1d1d11a80fdd92c0dace1e7e559fbdb225cb",
  version: "0.5.0",
  scripting: true,
  fullHtml5Parity: false
});
export type HtmlAccounting = Readonly<Record<keyof HtmlLimits, number>>;
interface Ledger {
  counts: Record<keyof HtmlLimits, number>;
  peaks: Record<keyof HtmlLimits, number>;
  aborted: boolean;
  pollSignal: boolean;
}
function createLedger(signal: AbortSignal): Ledger {
  const aborted = Boolean(signal?.aborted);
  const pollSignal = Boolean(signal && (typeof signal.addEventListener !== "function" || Object.prototype.hasOwnProperty.call(signal, "aborted")));
  const ledger: Ledger = {
    counts: { inputBytes: 0, decodedBytes: 0, retainedBytes: 0, nodes: 0, attributes: 0, depth: 0, tokenBytes: 0, work: 0, outputBytes: 0 },
    peaks: { inputBytes: 0, decodedBytes: 0, retainedBytes: 0, nodes: 0, attributes: 0, depth: 0, tokenBytes: 0, work: 0, outputBytes: 0 },
    aborted,
    pollSignal
  };
  if (signal && !aborted && !pollSignal) {
    signal.addEventListener("abort", () => { ledger.aborted = true; }, { once: true });
  }
  return ledger;
}
const invocationCounts = new WeakMap<HtmlOptions, Ledger>();
/** Own one cumulative accounting ledger for an invocation. */
export function invocationOptions(options: HtmlOptions): HtmlOptions {
  const owned = { signal: options.signal, limits: { ...options.limits } };
  invocationCounts.set(owned, createLedger(options.signal));
  return owned;
}
export class HtmlBudget {
  readonly limits: HtmlLimits;
  private ledger: Ledger;
  constructor(readonly options: HtmlOptions) {
    let ledger = invocationCounts.get(options);
    if (!ledger) {
      this.limits = { ...options.limits };
      for (const name of [
        "inputBytes",
        "decodedBytes",
        "retainedBytes",
        "nodes",
        "attributes",
        "depth",
        "tokenBytes",
        "work",
        "outputBytes"
      ] as const)
        if (this.limits[name] !== Infinity && (!Number.isSafeInteger(this.limits[name]) || this.limits[name] < 0))
          throw new HtmlError("E_LIMIT", "Expected nonnegative safe integer limits or Infinity", 0, name);
      ledger = createLedger(options.signal);
      invocationCounts.set(options, ledger);
    } else {
      this.limits = options.limits;
    }
    this.ledger = ledger;
    this.check();
  }
  check(): void {
    if (this.ledger.aborted || (this.ledger.pollSignal && this.options.signal.aborted))
      throw new HtmlError("E_CANCELLED", "HTML invocation cancelled");
  }
  bound(resource: keyof HtmlLimits, amount: number): void {
    this.check();
    if ((((amount | 0) !== amount || amount < 0) && (!Number.isSafeInteger(amount) || amount < 0)) || amount > this.limits[resource])
      throw new HtmlError("E_LIMIT", `HTML ${resource} limit exceeded`, 0, resource);
    if (amount > this.ledger.peaks[resource]) this.ledger.peaks[resource] = amount;
  }
  remaining(resource: keyof HtmlLimits): number {
    return this.limits[resource] - this.ledger.counts[resource];
  }
  snapshot(): HtmlAccounting {
    return Object.freeze(
      Object.fromEntries(
        (Object.keys(this.limits) as (keyof HtmlLimits)[]).map((key) => [
          key,
          Math.max(this.ledger.counts[key] ?? 0, this.ledger.peaks[key] ?? 0)
        ])
      )
    ) as HtmlAccounting;
  }
  charge(resource: keyof HtmlLimits, amount: number): void {
    const n = this.ledger.counts[resource] + amount;
    this.bound(resource, n);
    this.ledger.counts[resource] = n;
  }
}
