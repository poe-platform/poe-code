import { ExecutionLimitError, type ExecutionMeter } from "./execution-budget.js";

export type YieldDelegationResult<Value> =
  | { readonly kind: "yield"; readonly value: Value }
  | { readonly kind: "return"; readonly value: Value }
  | { readonly kind: "raise"; readonly error: unknown }
  | { readonly kind: "reject"; readonly error: unknown };

/** Guest iterator capabilities. Completion reads StopIteration's native value,
 * not an overridden attribute. Raw throw arguments must remain unnormalized
 * until the delegate has had an opportunity to receive them. */
export interface YieldDelegationContext<Value, Iterator, Method> {
  readonly none: Value;
  acquire(source: Value): Iterator;
  next(iterator: Iterator): Value;
  attribute(iterator: Iterator, name: "send" | "throw" | "close"): Method;
  call(method: Method, arguments_: readonly Value[]): Value;
  isException(error: unknown, kind: "BaseException" | "GeneratorExit" | "AttributeError"): boolean;
  completion(error: unknown): { readonly value: Value } | undefined;
  throwArguments(error: unknown): readonly Value[];
  /** Normalize only when injection into the outer body is necessary. Invalid
   * request arguments throw a caller-side rejection; constructor failures that
   * must enter the body are returned as exception signals by this policy. */
  normalizeThrow(error: unknown): unknown;
  /** Report close-attribute lookup failures without replacing GeneratorExit. */
  unraisable(error: unknown, iterator: Iterator): void;
}

/** Delegation protocol state, separate from generator lifecycle. A reject is a
 * caller-side throw-attribute lookup failure: neither the Python body nor its
 * delegate has resumed, and the owner must keep its suspended state intact.
 * A raise instead enters the enclosing Python body's exception machinery.
 * The owner supplies frame activation and finalization. Construction and
 * iterator acquisition are separate; host return() is not Python close. */
export class YieldDelegation<Value, Iterator, Method> {
  #source: { readonly value: Value } | undefined;
  #iterator: { readonly value: Iterator } | undefined;
  #context: YieldDelegationContext<Value, Iterator, Method> | undefined;
  constructor(source: Value, context: YieldDelegationContext<Value, Iterator, Method>, private readonly meter: ExecutionMeter) {
    meter.checkpoint(1, 160);
    this.#source = { value: source }; this.#context = context;
  }

  #finish(): void { this.#source = undefined; this.#iterator = undefined; this.#context = undefined; }

  /** Acquired iterator identity, released with protocol completion. */
  get iterator():Iterator|undefined {return this.#iterator?.value;}

  start(): YieldDelegationResult<Value> {
    this.meter.checkpoint();
    if (this.#source === undefined || this.#context === undefined) throw Error("delegation already started");
    const context = this.#context, source = this.#source.value;
    try {
      const iterator = context.acquire(source); this.meter.checkpoint(0, 32);
      this.#iterator = { value: iterator }; this.#source = undefined;
    } catch (error) {
      // __iter__ raising StopIteration is not a delegated return.
      return this.#raise(error, context);
    }
    return this.#advance("next");
  }

  resume(request: { readonly kind: "send"; readonly value: Value } | { readonly kind: "throw"; readonly error: unknown }): YieldDelegationResult<Value> {
    this.meter.checkpoint();
    const context = this.#context, iterator = this.#iterator;
    if (context === undefined || iterator === undefined) throw Error("delegation is not suspended");
    if (request.kind === "send") {
      if (request.value === context.none) return this.#advance("next");
      this.meter.checkpoint(0, 8);
      return this.#advance("send", undefined, [request.value]);
    }
    const error = request.error;
    if (error instanceof ExecutionLimitError || !context.isException(error, "BaseException")) { this.#finish(); throw error; }
    const closing = context.isException(error, "GeneratorExit"); this.meter.checkpoint();
    this.meter.checkpoint(0,32);
    const captured={context,iterator:iterator.value};
    let method: Method;
    try { method = context.attribute(iterator.value, closing ? "close" : "throw"); this.meter.checkpoint(); }
    catch (lookupError) {
      if (lookupError instanceof ExecutionLimitError || !context.isException(lookupError, "BaseException")) { this.#finish(); throw lookupError; }
      const missing = context.isException(lookupError, "AttributeError"); this.meter.checkpoint();
      if (missing) return this.#inject(error, context);
      if (closing) {
        context.unraisable(lookupError, iterator.value); this.meter.checkpoint();
        return this.#inject(error, context);
      }
      this.meter.checkpoint(0, 32);
      return { kind: "reject", error: lookupError };
    }
    if (closing) return this.#advance("close", method, [], error,captured);
    const arguments_ = context.throwArguments(error); this.meter.checkpoint();
    return this.#advance("throw", method, arguments_,undefined,captured);
  }

  #raise(error: unknown, context: YieldDelegationContext<Value, Iterator, Method>): YieldDelegationResult<Value> {
    this.#finish();
    if (error instanceof ExecutionLimitError || !context.isException(error, "BaseException")) throw error;
    this.meter.checkpoint(0, 32);
    return { kind: "raise", error };
  }

  #inject(error: unknown, context: YieldDelegationContext<Value, Iterator, Method>): YieldDelegationResult<Value> {
    let normalized: unknown;
    try { normalized = context.normalizeThrow(error); this.meter.checkpoint(); }
    catch (failure) {
      if (failure instanceof ExecutionLimitError || !context.isException(failure, "BaseException")) { this.#finish(); throw failure; }
      this.meter.checkpoint(0, 32);
      return { kind: "reject", error: failure };
    }
    return this.#raise(normalized, context);
  }

  #advance(operation: "next" | "send" | "throw" | "close", method?: Method, arguments_: readonly Value[] = [], closingError?: unknown,captured?:{readonly context:YieldDelegationContext<Value,Iterator,Method>;readonly iterator:Iterator}): YieldDelegationResult<Value> {
    const context = captured?.context??this.#context!, iterator = captured===undefined?this.#iterator!.value:captured.iterator;
    this.meter.checkpoint(1, 32);
    let value: Value;
    try {
      if (operation === "next") value = context.next(iterator);
      else {
        if (operation === "send") method = context.attribute(iterator, "send");
        this.meter.checkpoint();
        value = context.call(method!, arguments_);
      }
      this.meter.checkpoint();
    } catch (error) {
      if (error instanceof ExecutionLimitError) { this.#finish(); throw error; }
      const completion = context.completion(error); this.meter.checkpoint();
      if (completion !== undefined) { this.#finish(); return { kind: "return", value: completion.value }; }
      return this.#raise(error, context);
    }
    if (operation === "close") return this.#inject(closingError, context);
    return { kind: "yield", value };
  }
}
