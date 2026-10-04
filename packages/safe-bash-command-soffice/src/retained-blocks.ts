/** Scalar handles into a shared bounded collection of retained text blocks. */
export interface RetainedTextSnapshot { readonly firstPage: number; readonly firstBlock: number; readonly count: number }

export interface RetainedTextBlocks {
  table?(snapshot: RetainedTextSnapshot, index: number): Promise<RetainedTable | undefined>;
  isHeading(snapshot: RetainedTextSnapshot, index: number): Promise<boolean>;
  streamBlock(snapshot: RetainedTextSnapshot, index: number, range?: { readonly start: number; readonly length: number }): AsyncIterable<Uint8Array>;
}

export interface RetainedTable {
  readonly rows: number;
  readonly columns: number;
  cells(row: number): Promise<number>;
  streamCell(row: number, column: number): AsyncIterable<Uint8Array>;
}
