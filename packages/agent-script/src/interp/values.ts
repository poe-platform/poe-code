const sandboxClosureBrand = Symbol("SandboxClosure");
const sandboxPromiseBrand = Symbol("SandboxPromise");

export type SandboxPrimitive = string | number | boolean | null | undefined;

export type SandboxValue =
  | SandboxPrimitive
  | SandboxObject
  | SandboxArray
  | SandboxClosure
  | SandboxPromise;

export type SandboxObject = {
  [key: string]: SandboxValue;
};

export type SandboxArray = SandboxValue[];

export type SandboxCallContext = {
  readonly stack: readonly string[];
};

export type SandboxClosure = {
  readonly async?: true;
  readonly kind: "fn";
  readonly name?: string;
  readonly properties?: SandboxObject;
  readonly call: (
    args: readonly SandboxValue[],
    context?: SandboxCallContext
  ) => SandboxValue | Promise<SandboxValue>;
  readonly [sandboxClosureBrand]: true;
};

export type SandboxPromise = {
  readonly kind: "promise";
  readonly promise: Promise<SandboxValue>;
  readonly [sandboxPromiseBrand]: true;
};

type CopyFromSandboxOptions = {
  wrapClosure?: (value: SandboxClosure) => unknown;
};

type CopyState<TValue> = {
  seen: WeakMap<object, TValue>;
};

export function createSandboxClosure(input: {
  async?: boolean;
  call: (
    args: readonly SandboxValue[],
    context?: SandboxCallContext
  ) => SandboxValue | Promise<SandboxValue>;
  name?: string;
  properties?: SandboxObject;
}): SandboxClosure {
  const closure = {
    kind: "fn" as const,
    call: input.call,
    name: input.name,
    ...(input.async === true ? { async: true as const } : {})
  } as SandboxClosure;

  Object.defineProperty(closure, sandboxClosureBrand, {
    enumerable: false,
    value: true
  });

  if (input.properties !== undefined) {
    Object.defineProperty(closure, "properties", {
      enumerable: false,
      value: Object.freeze(input.properties)
    });
  }

  return Object.freeze(closure);
}

export function createSandboxPromise(promise: Promise<SandboxValue>): SandboxPromise {
  const sandboxPromise = {
    kind: "promise" as const,
    promise
  } as SandboxPromise;

  Object.defineProperty(sandboxPromise, sandboxPromiseBrand, {
    enumerable: false,
    value: true
  });

  return Object.freeze(sandboxPromise);
}

export function isSandboxClosure(value: unknown): value is SandboxClosure {
  return typeof value === "object" && value !== null && sandboxClosureBrand in value;
}

export function isSandboxPromise(value: unknown): value is SandboxPromise {
  return typeof value === "object" && value !== null && sandboxPromiseBrand in value;
}

export function deepCopyToSandbox(value: unknown): SandboxValue {
  return copyToSandbox(value, {
    seen: new WeakMap()
  });
}

export function deepCopyFromSandbox(
  value: SandboxPromise,
  options?: CopyFromSandboxOptions
): Promise<unknown>;
export function deepCopyFromSandbox(value: SandboxValue, options?: CopyFromSandboxOptions): unknown;
export function deepCopyFromSandbox(
  value: SandboxValue,
  options: CopyFromSandboxOptions = {}
): unknown {
  return copyFromSandbox(
    value,
    {
      seen: new WeakMap()
    },
    "<root>",
    options
  );
}

function copyToSandbox(
  value: unknown,
  state: CopyState<SandboxValue>,
  path = "<root>"
): SandboxValue {
  if (isSandboxPrimitive(value)) {
    return value;
  }

  if (isSandboxClosure(value) || isSandboxPromise(value)) {
    return value;
  }

  if (isHostPromise(value)) {
    return createSandboxPromise(
      Promise.resolve(value).then(
        (resolved) => copyToSandbox(resolved, { seen: new WeakMap() }),
        (reason) => Promise.reject(copyToSandbox(reason, { seen: new WeakMap() }))
      )
    );
  }

  if (isPlainArray(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = new Array(value.length) as SandboxArray;
    state.seen.set(value, copy);

    for (const entry of getEnumerableArrayEntries(value, path)) {
      copy[entry.index] = copyToSandbox(entry.value, state, `${path}[${entry.index}]`);
    }

    return copy;
  }

  if (isPlainObject(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = createPlainObject(Object.getPrototypeOf(value) === null);
    state.seen.set(value, copy);

    for (const entry of getEnumerableObjectEntries(value, path)) {
      defineOwnDataProperty(
        copy,
        entry.key,
        copyToSandbox(entry.value, state, joinPath(path, entry.key))
      );
    }

    return copy;
  }

  throw new TypeError(`Unsupported sandbox value at ${path}: ${describeValue(value)}`);
}

function copyFromSandbox(
  value: SandboxValue,
  state: CopyState<unknown>,
  path = "<root>",
  options: CopyFromSandboxOptions
): unknown {
  if (isSandboxPrimitive(value)) {
    return value;
  }

  if (isSandboxClosure(value)) {
    if (options.wrapClosure === undefined) {
      throw new TypeError(
        "Sandbox closures cannot cross into host values without an explicit wrapper."
      );
    }

    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const wrapped = options.wrapClosure(value);
    state.seen.set(value, wrapped);
    return wrapped;
  }

  if (isSandboxPromise(value)) {
    return value.promise.then(
      (resolved) => copyFromSandbox(resolved, { seen: new WeakMap() }, "<root>", options),
      (reason: SandboxValue) =>
        Promise.reject(copyFromSandbox(reason, { seen: new WeakMap() }, "<root>", options))
    );
  }

  if (isPlainArray(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = new Array(value.length);
    state.seen.set(value, copy);

    for (const entry of getEnumerableArrayEntries(value, path)) {
      copy[entry.index] = copyFromSandbox(entry.value, state, `${path}[${entry.index}]`, options);
    }

    return copy;
  }

  if (isPlainObject(value)) {
    const existing = state.seen.get(value);
    if (existing !== undefined) {
      return existing;
    }

    const copy = createPlainObject(Object.getPrototypeOf(value) === null) as Record<
      string,
      unknown
    >;
    state.seen.set(value, copy);

    for (const entry of getEnumerableObjectEntries(value, path)) {
      defineOwnDataProperty(
        copy,
        entry.key,
        copyFromSandbox(entry.value, state, joinPath(path, entry.key), options)
      );
    }

    return copy;
  }

  throw new TypeError(`Unsupported sandbox value at ${path}: ${describeValue(value)}`);
}

function isSandboxPrimitive(value: unknown): value is SandboxPrimitive {
  return (
    value === null ||
    value === undefined ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean"
  );
}

function isHostPromise(value: unknown): value is Promise<unknown> {
  return value instanceof Promise;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }

  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function isPlainArray(value: unknown): value is unknown[] {
  return Array.isArray(value) && Object.getPrototypeOf(value) === Array.prototype;
}

function createPlainObject(useNullPrototype: boolean): SandboxObject {
  return (useNullPrototype ? Object.create(null) : {}) as SandboxObject;
}

function defineOwnDataProperty(target: object, key: string, value: unknown): void {
  Object.defineProperty(target, key, {
    enumerable: true,
    configurable: true,
    writable: true,
    value
  });
}

function getEnumerableObjectEntries<TValue>(
  value: Record<string, TValue>,
  path: string
): Array<{ key: string; value: TValue }> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<{ key: string; value: TValue }> = [];

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (!descriptor.enumerable) {
      continue;
    }

    if ("get" in descriptor || "set" in descriptor) {
      throw new TypeError(`Unsupported sandbox value at ${joinPath(path, key)}: accessor property`);
    }

    entries.push({
      key,
      value: descriptor.value as TValue
    });
  }

  return entries;
}

function getEnumerableArrayEntries<TValue>(
  value: TValue[],
  path: string
): Array<{ index: number; value: TValue }> {
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const entries: Array<{ index: number; value: TValue }> = [];

  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (key === "length" || !descriptor.enumerable) {
      continue;
    }

    if (!isArrayIndexKey(key)) {
      throw new TypeError(
        `Unsupported sandbox value at ${path}: non-index array property '${key}'`
      );
    }

    if ("get" in descriptor || "set" in descriptor) {
      throw new TypeError(`Unsupported sandbox value at ${path}[${key}]: accessor property`);
    }

    entries.push({
      index: Number(key),
      value: descriptor.value as TValue
    });
  }

  return entries;
}

function isArrayIndexKey(value: string): boolean {
  if (value === "") {
    return false;
  }

  const index = Number(value);
  return Number.isInteger(index) && index >= 0 && index < 4_294_967_295 && String(index) === value;
}

function describeValue(value: unknown): string {
  if (typeof value === "function") {
    return "function";
  }

  if (typeof value === "bigint" || typeof value === "symbol") {
    return typeof value;
  }

  if (typeof value === "object" && value !== null) {
    return value.constructor?.name ?? "Object";
  }

  return typeof value;
}

function joinPath(path: string, key: string): string {
  return path === "<root>" ? `<root>.${key}` : `${path}.${key}`;
}
