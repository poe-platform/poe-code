import type { SandboxCallContext, SandboxClosure, SandboxValue } from "./values.js";

type NativeAccessor = (...args: never[]) => unknown;

const accessorClosures = new WeakMap<object, SandboxClosure>();
const getterAdapters = new WeakMap<SandboxClosure, () => undefined>();
const setterAdapters = new WeakMap<SandboxClosure, (value: unknown) => void>();

/** Native descriptors store identity only. Guest code runs through invokeClosure. */
export function accessorAdapter(closure: SandboxClosure, kind: "get" | "set"): NativeAccessor {
  if (kind === "get") {
    let adapter = getterAdapters.get(closure);
    if (adapter === undefined) {
      // In particular, native Promise transport must not execute a guest `then`
      // getter when carrying an ordinary interpreter result between async frames.
      adapter = () => undefined;
      getterAdapters.set(closure, adapter);
      accessorClosures.set(adapter, closure);
    }
    return adapter;
  }
  let adapter = setterAdapters.get(closure);
  if (adapter === undefined) {
    adapter = () => {
      throw new TypeError("Accessor writes require sandbox execution.");
    };
    setterAdapters.set(closure, adapter);
    accessorClosures.set(adapter, closure);
  }
  return adapter;
}

export function accessorClosure(adapter: NativeAccessor | undefined): SandboxClosure | undefined {
  if (adapter === undefined) return undefined;
  const closure = accessorClosures.get(adapter);
  if (closure === undefined) throw new TypeError("Native accessors cannot execute in the sandbox.");
  return closure;
}

export function retainedAccessorClosures(descriptor: PropertyDescriptor): SandboxClosure[] {
  const closures: SandboxClosure[] = [];
  for (const adapter of [descriptor.get, descriptor.set]) {
    const closure = adapter === undefined ? undefined : accessorClosures.get(adapter);
    if (closure !== undefined) closures.push(closure);
  }
  return closures;
}

export function readPropertyDescriptor(
  descriptor: PropertyDescriptor,
  receiver: SandboxValue,
  context?: SandboxCallContext,
  allowNativeGetter = false
): SandboxValue | Promise<SandboxValue> {
  if ("value" in descriptor) return descriptor.value;
  if (descriptor.get === undefined) return undefined;
  const getter = accessorClosures.get(descriptor.get);
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
