import type { CallStack } from "./call-stack.js";
import type { ConstantValues } from "./constant-values.js";
import type { ExecutionMeter } from "./execution-budget.js";
import type { KeyOperations } from "./ordered-key-map.js";
import type { RuntimeHashContext } from "./runtime-hash.js";
import { createRuntimeKeyOperations } from "./runtime-key-operations.js";
import { hasRuntimeInstanceAttributes, type BuiltinInvocationContext, type RuntimeValue } from "./runtime-values.js";

/** Stable collection policy shared with registry/bootstrap storage. Frame-local
 * protocol adapters follow the active call stack, not the collection creator.
 * Weak bindings do not keep exited frames alive. Guest keys need an active bound
 * frame; native bootstrap keys and explicit extension hashes remain available.
 */
export class RuntimeExecutionKeys implements KeyOperations<RuntimeValue> {
  readonly #frames = new WeakMap<object, KeyOperations<RuntimeValue>>();
  readonly #native: KeyOperations<RuntimeValue>;

  constructor(private readonly values: ConstantValues, private readonly base: RuntimeHashContext, private readonly meter: ExecutionMeter, private readonly calls: Pick<CallStack<object>, "current">) {
    meter.checkpoint(0, 128);
    this.#native = createRuntimeKeyOperations(values, { ...base, guestHash(value) {
      const explicit = base.guestHash?.(value); meter.checkpoint();
      if (explicit !== undefined) return explicit;
      if (hasRuntimeInstanceAttributes(value) || value.kind === "type") throw Error("guest key hashing requires an active runtime frame");
      return undefined;
    } }, meter);
  }

  bindInvocation(frame: object, invocation: BuiltinInvocationContext): void {
    this.meter.checkpoint(0, 48);
    this.#frames.set(frame, createRuntimeKeyOperations(this.values, this.base, this.meter, invocation));
  }

  hash(value: RuntimeValue): bigint {
    this.meter.checkpoint();
    const frame = this.calls.current;
    return (frame === undefined ? this.#native : this.#frames.get(frame) ?? this.#native).hash(value);
  }

  equal(stored: RuntimeValue, incoming: RuntimeValue): boolean {
    this.meter.checkpoint();
    const frame = this.calls.current;
    return (frame === undefined ? this.#native : this.#frames.get(frame) ?? this.#native).equal(stored, incoming);
  }
}
