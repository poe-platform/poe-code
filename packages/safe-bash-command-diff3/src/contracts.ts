export type Diff3File = 'base' | 'left' | 'right';
export interface Diff3Limits {
  readonly inputBytes: number;
  readonly retainedBytes: number;
  readonly tokens: number;
  /** Simultaneously retained numeric edit-graph and indexing cells. */
  readonly graphCells: number;
  /** Byte scanning/comparison, graph visits, and range processing. */
  readonly work: number;
}
export interface Diff3Options { readonly stripTrailingCR?: boolean; readonly text?: boolean }
export type Diff3ErrorCode = 'LIMIT' | 'CANCELLED' | 'CLOSED' | 'STATE' | 'BINARY' | 'ALIGNMENT';
export class Diff3Error extends Error {
  constructor(readonly code: Diff3ErrorCode, message: string, readonly resource?: keyof Diff3Limits) {
    super(message); this.name = 'Diff3Error';
  }
}
/** Bytes include the original LF, if present; CR is never removed here. */
export interface Diff3Line { readonly bytes: Uint8Array; readonly terminated: boolean }
/** Zero-based half-open line range; empty ranges are insertion boundaries. */
export interface Diff3Range { readonly start: number; readonly end: number }
export interface Diff3Edit { readonly base: Diff3Range; readonly variant: Diff3Range }
export interface Diff3Region {
  /** GNU treats adjacent changes as DIFF_ALL too; retain the distinction. */
  readonly kind: 'left' | 'right' | 'identical' | 'adjacent' | 'conflict';
  readonly base: Diff3Range;
  readonly left: Diff3Range;
  readonly right: Diff3Range;
}
export interface Diff3Analysis {
  readonly files: Readonly<Record<Diff3File, readonly Diff3Line[]>>;
  readonly leftEdits: readonly Diff3Edit[];
  readonly rightEdits: readonly Diff3Edit[];
  readonly regions: readonly Diff3Region[];
  readonly alignmentProfile: 'gnu-3.12-qualified';
}
export interface Diff3Accounting {
  readonly inputBytes: number;
  readonly retainedBytes: number;
  readonly peakRetainedBytes: number;
  readonly tokens: number;
  readonly graphCells: number;
  readonly peakGraphCells: number;
  readonly work: number;
}
export interface Diff3Engine {
  push(file: Diff3File, bytes: Uint8Array): void;
  end(file: Diff3File): void;
  /** One-shot transfer of owned byte tokens and ranges to the caller. */
  finish(): Diff3Analysis;
  /** Register this idempotent cleanup before feeding invocation byte streams. */
  dispose(): void;
  accounting(): Diff3Accounting;
}
