export interface ArgumentLimits {
  readonly maxArguments: number;
  readonly maxArgumentBytes: number;
}

/** Invocation-owned bytes. Returned copies cannot mutate retained arguments. */
export class OwnedArguments {
  readonly #arguments: readonly Uint8Array[];
  readonly length: number;
  readonly byteLength: number;
  constructor(input: readonly Uint8Array[], limits: ArgumentLimits) {
    for (const limit of [limits.maxArguments, limits.maxArgumentBytes]) {
      if (!Number.isSafeInteger(limit) || limit < 0) throw new RangeError("invalid argv limit");
    }
    if (input.length > limits.maxArguments) throw new RangeError("argv count limit exceeded");
    const admitted: Uint8Array[] = [];
    let total = 0;
    for (const argument of input) {
      total += argument.byteLength;
      if (!Number.isSafeInteger(total) || total > limits.maxArgumentBytes) {
        throw new RangeError("argv byte limit exceeded");
      }
      admitted.push(argument);
    }
    this.#arguments = admitted.map(argument => Uint8Array.from(argument));
    this.length = admitted.length;
    this.byteLength = total;
    Object.freeze(this);
  }
  bytes(index: number): Uint8Array | undefined {
    const argument = this.#arguments[index];
    return argument === undefined ? undefined : Uint8Array.from(argument);
  }
}
