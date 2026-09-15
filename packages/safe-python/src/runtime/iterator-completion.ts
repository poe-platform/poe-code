/** Trusted adapter completion metadata. Host loops consume done normally;
 * explicit guest next operations may rethrow an already classified exhaustion
 * object. A box distinguishes a thrown undefined from absent metadata. The
 * exception belongs to this pull, never to persistent cursor state. */
export type CompletionResult<Value> = IteratorYieldResult<Value> | (IteratorReturnResult<unknown> & {
  readonly exception?: { readonly value: unknown };
});

/** Ordinary host iterators are structurally compatible and need no adapter. */
export interface CompletionIterator<Value> extends Iterator<Value> {
  next(): CompletionResult<Value>;
  /** Optional advisory remaining length. Undefined maps to NotImplemented;
   * callers must not interpret a hint as an exact count or allocation budget. */
  lengthHint?(): number | bigint | undefined;
}
