/** Scalar handles into a shared bounded collection of retained text blocks. */
export interface RetainedTextSnapshot { readonly firstPage: number; readonly firstBlock: number; readonly count: number }

export interface RetainedTextBlocks {
  isHeading(snapshot: RetainedTextSnapshot, index: number): Promise<boolean>;
  streamBlock(snapshot: RetainedTextSnapshot, index: number, range?: { readonly start: number; readonly length: number }): AsyncIterable<Uint8Array>;
}
