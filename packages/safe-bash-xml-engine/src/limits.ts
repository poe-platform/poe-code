export type XmlCheckpoint = (signal: AbortSignal) => Promise<void>;

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
  maxInputBytes: Infinity,
  maxOutputBytes: Infinity,
  maxSourceBytes: Infinity,
  maxDepth: Infinity,
  maxNodes: Infinity,
  maxAttributes: Infinity,
  maxAttributesPerElement: Infinity,
  maxNamespaces: Infinity,
  maxSteps: Infinity,
  maxResults: Infinity
});
export class XmlQueryError extends Error {
  constructor(
    message: string,
    readonly status: number
  ) {
    super(message);
  }
}
export class XmlQueryLimitError extends XmlQueryError {
  constructor(name: keyof XmlQueryLimits) {
    super(`${name} limit exceeded`, 5);
  }
}
export function resolveXmlQueryLimits(options: Partial<XmlQueryLimits> = {}): XmlQueryLimits {
  const limits = { ...defaultXmlQueryLimits, ...options };
  for (const [name, value] of Object.entries(limits)) {
    if (
      !Object.hasOwn(defaultXmlQueryLimits, name) ||
      (value !== Infinity && !Number.isSafeInteger(value)) ||
      value < 1
    ) {
      throw new RangeError(`${name} must be a positive safe integer XML limit`);
    }
  }
  return Object.freeze(limits);
}
export class XmlBudget {
  private steps = 0;
  private checkpoint = 0;
  outputBytes = 0;
  inputBytes = 0;
  constructor(
    readonly limits: XmlQueryLimits,
    readonly signal: AbortSignal,
    private readonly checkpointTurn: XmlCheckpoint
  ) {}
  async tick(work = 1): Promise<void> {
    this.signal.throwIfAborted();
    this.steps += work;
    if (this.steps > this.limits.maxSteps) throw new XmlQueryLimitError("maxSteps");
    this.checkpoint += work;
    if (this.checkpoint >= 1024) {
      this.checkpoint = 0;
      await this.checkpointTurn(this.signal);
    }
  }
  results(size: number): void {
    if (size > this.limits.maxResults) throw new XmlQueryLimitError("maxResults");
  }
}
