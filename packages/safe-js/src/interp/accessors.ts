import type { SandboxCallContext, SandboxClosure, SandboxValue } from "./values.js";
import type { Budget } from "./budget.js";
import { resolveIntrinsicIdentity } from "./intrinsics.js";

type NativeAccessor = (...args: never[]) => unknown;

const accessorClosures = new WeakMap<object, SandboxClosure>();
const getterAdapters = new WeakMap<SandboxClosure, () => undefined>();
const setterAdapters = new WeakMap<SandboxClosure, (value: unknown) => void>();
const readAccessorClosure = WeakMap.prototype.get.bind(accessorClosures);
const writeAccessorClosure = WeakMap.prototype.set.bind(accessorClosures);
const readGetterAdapter = WeakMap.prototype.get.bind(getterAdapters);
const writeGetterAdapter = WeakMap.prototype.set.bind(getterAdapters);
const readSetterAdapter = WeakMap.prototype.get.bind(setterAdapters);
const writeSetterAdapter = WeakMap.prototype.set.bind(setterAdapters);
// Strict arguments carry this native intrinsic; translate its identity, never execute it.
const nativeRestrictedAccessor = Object.getOwnPropertyDescriptor(Function.prototype, "caller")!.get;

/** Native descriptors store identity only. Guest code runs through invokeClosure. */
export function accessorAdapter(closure: SandboxClosure, kind: "get" | "set"): NativeAccessor {
  if (kind === "get") {
    let adapter = readGetterAdapter(closure);
    if (adapter === undefined) {
      // In particular, native Promise transport must not execute a guest `then`
      // getter when carrying an ordinary interpreter result between async frames.
      adapter = () => undefined;
      writeGetterAdapter(closure, adapter);
      writeAccessorClosure(adapter, closure);
    }
    return adapter;
  }
  let adapter = readSetterAdapter(closure);
  if (adapter === undefined) {
    adapter = () => {
      throw new TypeError("Accessor writes require sandbox execution.");
    };
    writeSetterAdapter(closure, adapter);
    writeAccessorClosure(adapter, closure);
  }
  return adapter;
}

export function accessorClosure(adapter: NativeAccessor | undefined, budget?: Budget): SandboxClosure | undefined {
  if (adapter === undefined) return undefined;
  if (budget !== undefined && adapter === nativeRestrictedAccessor)
    return resolveIntrinsicIdentity(budget, '["%ThrowTypeError%"]') as SandboxClosure;
  const closure = readAccessorClosure(adapter);
  if (closure === undefined) throw new TypeError("Native accessors cannot execute in the sandbox.");
  return closure;
}

export function retainedAccessorClosures(descriptor: PropertyDescriptor): SandboxClosure[] {
  // Capture both adapters before resolving them; descriptors can have native
  // getters. Array literals bypass later push hooks and inherited index setters.
  const getter = descriptor.get, setter = descriptor.set;
  const get = getter === undefined ? undefined : readAccessorClosure(getter);
  const set = setter === undefined ? undefined : readAccessorClosure(setter);
  return get === undefined ? set === undefined ? [] : [set]
    : set === undefined ? [get] : [get, set];
}

export function readPropertyDescriptor(
  descriptor: PropertyDescriptor,
  receiver: SandboxValue,
  context?: SandboxCallContext,
  allowNativeGetter = false
): SandboxValue | Promise<SandboxValue> {
  if ("value" in descriptor) return descriptor.value;
  if (descriptor.get === undefined) return undefined;
  const getter = readAccessorClosure(descriptor.get);
  // Low-level interpreter callers can supply trusted native getters. Public
  // host admission still rejects them; preserve that existing internal route.
  if (getter === undefined) {
    if (!allowNativeGetter) throw new TypeError("Native accessors cannot execute in the sandbox.");
    return Reflect.apply(descriptor.get, receiver, []) as SandboxValue;
  }
  if (context?.invokeClosure === undefined)
    throw new TypeError("Accessor reads require sandbox execution.");
  return context.invokeClosure(getter, [], receiver);
}

export function writePropertyDescriptor(
  descriptor: PropertyDescriptor,
  receiver: SandboxValue,
  value: SandboxValue,
  context?: SandboxCallContext
): Promise<void> {
  const setter = accessorClosure(descriptor.set);
  if (setter === undefined) throw new TypeError("Cannot assign to a getter-only property.");
  if (context?.invokeClosure === undefined)
    throw new TypeError("Accessor writes require sandbox execution.");
  return context.invokeClosure(setter, [value], receiver).then(() => undefined);
}
