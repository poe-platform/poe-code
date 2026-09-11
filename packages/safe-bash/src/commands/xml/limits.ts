import { yieldTurn } from "../../contracts/yield.js";

export interface XmlQueryLimits {
  readonly maxInputBytes: number;
  readonly maxOutputBytes: number;
  readonly maxSourceBytes: number;
  readonly maxDepth: number;
  readonly maxNodes: number;
  readonly maxAttributes: number;
  readonly maxAttributesPerElement: number;
  readonly maxNamespaces: number;
  readonly maxSteps: number;
  readonly maxResults: number;
}
export interface XmlCommandsOptions {
  readonly replace?: boolean;
  readonly limits?: Partial<XmlQueryLimits>;
}
export const defaultXmlQueryLimits: Readonly<XmlQueryLimits> = Object.freeze({
  maxInputBytes: 8 * 1024 * 1024, maxOutputBytes: 8 * 1024 * 1024,
  maxSourceBytes: 64 * 1024, maxDepth: 64, maxNodes: 100_000,
  maxAttributes: 10_000, maxAttributesPerElement: 128,
  maxNamespaces: 256, maxSteps: 1_000_000, maxResults: 100_000,
});
export class XmlQueryError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}
export class XmlQueryLimitError extends XmlQueryError {
  constructor(name: keyof XmlQueryLimits) { super(`${name} limit exceeded`, 5); }
}
export function resolveXmlQueryLimits(options: Partial<XmlQueryLimits> = {}): XmlQueryLimits {
  const limits = { ...defaultXmlQueryLimits, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (!Object.hasOwn(defaultXmlQueryLimits, name) || !Number.isSafeInteger(value) || value < 1) {
      throw new RangeError(`${name} must be a positive safe integer XML limit`);
    }
  }
  if (limits.maxDepth > 256) throw new RangeError("maxDepth must be <=256");
  return Object.freeze(limits);
}
export class XmlBudget {
  private steps = 0;
  private checkpoint = 0;
  outputBytes = 0;
  constructor(readonly limits: XmlQueryLimits, readonly signal: AbortSignal) {}
  async tick(work = 1): Promise<void> {
    this.signal.throwIfAborted();
    this.steps += work;
    if (this.steps > this.limits.maxSteps) throw new XmlQueryLimitError("maxSteps");
    this.checkpoint += work;
    if (this.checkpoint >= 1024) {
      this.checkpoint = 0;
      await yieldTurn(this.signal);
    }
  }
  results(size: number): void {
    if (size > this.limits.maxResults) throw new XmlQueryLimitError("maxResults");
  }
}
