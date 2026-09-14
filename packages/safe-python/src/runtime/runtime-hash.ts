import type { ConstantValue, PrimitiveConstant, SliceConstant, TupleConstant } from "./constant-values.js";
import type { CodePointString } from "./code-point-string.js";
import type { ImmutableBytes } from "./immutable-bytes.js";
import type { ExecutionMeter } from "./execution-budget.js";
import { hashReal } from "./real-comparison.js";
import { PythonRuntimeError } from "./error.js";
import type { BuiltinInvocationContext, RangeValue, RuntimeValue } from "./runtime-values.js";
import { protocolHash, type HashProtocolContext } from "./hash-protocol.js";
import { RuntimeHashError } from "./runtime-hash-error.js";
import { diagnosticTypeName } from "./diagnostic-type-name.js";

/** Trusted runtime policies. Identity hashes must remain stable for each object;
 * payload hashes must use one execution-wide seed and respect value equality.
 * Payload implementations own per-element metering. No guest methods run here.
 */
export interface ConstantHashContext {
  identity(value: PrimitiveConstant): bigint;
  string(value: CodePointString, meter: ExecutionMeter): bigint;
  bytes(value: ImmutableBytes, meter: ExecutionMeter): bigint;
}

export interface RuntimeHashContext extends ConstantHashContext {
  describeException?: BuiltinInvocationContext["describeException"];
  hashErrorTypeName?: BuiltinInvocationContext["hashErrorTypeName"];
  /** Select guest type-slot dispatch for a value, including nested immutable
   * members. Undefined retains the exact native path. Keep this policy stable
   * for the lifetime of hashed dictionary/set keys. */
  guestHash?(value: RuntimeValue): HashProtocolContext<RuntimeValue> | undefined;
  /** The execution's canonical None is needed for equality-normalized ranges. */
  readonly none: Extract<PrimitiveConstant, { kind: "none" }>;
  identity(value: RuntimeValue): bigint;
}

/** Identifies an exact built-in hash rejection without matching error text. */
export class UnhashableRuntimeValueError extends PythonRuntimeError {
  constructor(kind: "list" | "dict" | "set" | "cell" | "dict_keys" | "dict_items") {
    super("TypeError", `unhashable type: '${kind}'`);
  }
}

const prime1 = 11400714785074694791n;
const prime2 = 14029467366897019727n;
const prime5 = 2870177450012600261n;
type Container = TupleConstant<RuntimeValue> | SliceConstant<RuntimeValue> | RangeValue;
interface Frame { value: Container; index: number; length: number; accumulator: bigint }

function member(value: Container, index: number, context: ConstantHashContext | RuntimeHashContext, meter: ExecutionMeter): RuntimeValue {
  if (value.kind === "range") {
    if (!("none" in context)) throw new Error("runtime hash context is required for range values");
    const range = value.value;
    if (index !== 0 && (range.length === 0n || (index === 2 && range.length === 1n))) return context.none;
    meter.checkpoint(1, 32);
    return Object.freeze({ kind: "int", value: index === 0 ? range.length : index === 1 ? range.start : range.step });
  }
  return value.kind === "tuple" ? value.items[index] : index === 0 ? value.start : index === 1 ? value.stop : value.step;
}

function normalized(hash: bigint): bigint {
  const signed = BigInt.asIntN(64, hash);
  return signed === -1n ? -2n : signed;
}

/** Fixed 64-bit numeric/tuple/slice/range hashing, using an explicit stack rather than
 * recursive host calls. The stack is charged before growth; full bigint
 * temporary and host object overhead accounting is not yet implemented.
 * Range frames hash a virtual canonical tuple without expanding the progression.
 * Lists are unhashable even inside immutable keys; functions/iterators use the
 * trusted identity policy. An optional selector supplies guest __hash__ dispatch.
 */
export function runtimeHash(value: ConstantValue, context: ConstantHashContext, meter: ExecutionMeter): bigint;
export function runtimeHash(value: RuntimeValue, context: RuntimeHashContext, meter: ExecutionMeter): bigint;
export function runtimeHash(value: RuntimeValue, context: ConstantHashContext | RuntimeHashContext, meter: ExecutionMeter): bigint {
  const stack: (Frame | { instance: RuntimeValue })[] = [];
  let current: RuntimeValue | undefined = value;
  let result = 0n;
  let rootGuest: HashProtocolContext<RuntimeValue> | undefined;
  while (true) {
    meter.checkpoint();
    if (current !== undefined) {
      const guest = "none" in context ? context.guestHash?.(current) : undefined;
      meter.checkpoint(0);
      if (current === value) rootGuest = guest;
      if (guest !== undefined) {
        try { result = protocolHash(current, guest, meter); }
        catch (error) {
          meter.checkpoint();
          const describe = "none" in context ? context.describeException?.(error, "TypeError") : undefined;
          if (describe === undefined && (!(error instanceof PythonRuntimeError) || error.name !== "TypeError")) throw error;
          const type = rootGuest === undefined ? value.kind : rootGuest.typeName(value);
          const name = "none" in context && context.hashErrorTypeName !== undefined
            ? () => context.hashErrorTypeName!(value) : diagnosticTypeName(type, meter);
          throw new RuntimeHashError(name, error, meter, describe);
        }
      }
      else if (current.kind === "tuple" || current.kind === "slice" || current.kind === "range") {
        const length = current.kind === "tuple" ? current.items.length : 3;
        if (length !== 0) {
          meter.checkpoint(0, 48);
          stack.push({ value: current, index: 0, length, accumulator: prime5 });
          current = member(current, 0, context, meter);
          continue;
        }
        result = BigInt.asIntN(64, prime5 + (prime5 ^ 3527539n));
      } else {
        switch (current.kind) {
          // CPython 3.14's none_hash is independent of object identity and seeds.
          case "none": result = 0xfca86420n; break;
          case "frozenset": result = current.items.keySetHash(); break;
          case "mappingproxy": current = current.value; continue;
          case "method": {
            if (!("none" in context)) throw new Error("runtime hash context is required for bound methods");
            meter.checkpoint(0, 32);
            stack.push({ instance: current.value.instance });
            current = current.value.function; continue;
          }
          case "list": case "dict": case "set": case "cell": case "dict_keys": case "dict_items": throw new UnhashableRuntimeValueError(current.kind);
          case "builtin_function_or_method": {
            if (!("none" in context)) throw new Error("runtime hash context is required for native functions");
            if (current.binding === undefined) { result = normalized(context.identity(current)); break; }
            const instance = context.identity(current.binding.instance); meter.checkpoint();
            const implementation = context.identity(current.binding.implementation); meter.checkpoint();
            result = normalized(instance ^ implementation); break;
          }
          case "method-wrapper": {
            if (!("none" in context)) throw new Error("runtime hash context is required for method wrappers");
            const instance = context.identity(current.value.instance); meter.checkpoint();
            const descriptor = context.identity(current.value.descriptor); meter.checkpoint();
            result = normalized(instance ^ descriptor); break;
          }
          case "instance": case "function": case "iterator": case "method_descriptor": case "classmethod_descriptor": case "wrapper_descriptor": case "type": case "getset_descriptor": case "member_descriptor": case "dict_values": case "staticmethod": case "classmethod":
            if (!("none" in context)) throw new Error("runtime hash context is required for identity-based runtime values");
            result = normalized(context.identity(current)); break;
          case "bool": result = current.value ? 1n : 0n; break;
          case "int": result = hashReal(current.value)!; break;
          case "float": result = hashReal(current.value) ?? normalized(context.identity(current)); break;
          case "complex": {
            const real = hashReal(current.real) ?? normalized(context.identity(current));
            const imaginary = hashReal(current.imaginary) ?? normalized(context.identity(current));
            result = normalized(real + 1000003n * imaginary);
            break;
          }
          case "str": result = normalized(context.string(current.value, meter)); break;
          case "bytes": result = normalized(context.bytes(current.value, meter)); break;
          default: result = normalized(context.identity(current));
        }
      }
      current = undefined;
      // Observe cancellation or a latched failure from trusted callbacks before
      // publishing their result, even for a primitive root value.
      meter.checkpoint();
    }
    if (stack.length === 0) return result;
    const frame = stack[stack.length - 1];
    if ("instance" in frame) {
      if (!("none" in context)) throw new Error("runtime hash context is required for bound methods");
      const identity = normalized(context.identity(frame.instance)); meter.checkpoint();
      result = normalized(result ^ identity); stack.pop(); continue;
    }
    let accumulator = BigInt.asUintN(64, frame.accumulator + result * prime2);
    accumulator = BigInt.asUintN(64, (accumulator << 31n) | (accumulator >> 33n));
    frame.accumulator = BigInt.asUintN(64, accumulator * prime1);
    frame.index++;
    if (frame.index < frame.length) {
      current = member(frame.value, frame.index, context, meter);
    } else {
      let hash = frame.accumulator;
      if (frame.value.kind !== "slice") hash = BigInt.asUintN(64, hash + (BigInt(frame.length) ^ (prime5 ^ 3527539n)));
      result = BigInt.asIntN(64, hash);
      if (result === -1n) result = 1546275796n;
      stack.pop();
    }
  }
}
