/** A valid sequence index did not identify a model value. */
export class BoundsError extends RangeError {
  override readonly name = "BoundsError";
  readonly code = "missing-selection";
}

/** A throwing keyed lookup did not identify a model value. */
export class MissingKeyError extends RangeError {
  override readonly name = "MissingKeyError";
  readonly code = "missing-selection";
}

/** The model node was removed or replaced by a different node. */
export class StaleHandleError extends RangeError {
  override readonly name = "StaleHandleError";
  readonly code = "stale-selection";
}
