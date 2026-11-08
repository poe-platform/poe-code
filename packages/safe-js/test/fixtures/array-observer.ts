type Atom =
  | null
  | boolean
  | string
  | number
  | { tag: "undefined" }
  | { tag: "number"; value: string }
  | { tag: "bigint"; value: string }
  | { tag: "ref" | "symbol"; id: number }
  | { tag: "intrinsic"; name: string };

type Descriptor =
  | { kind: "data"; value: Atom; configurable: boolean; enumerable: boolean; writable: boolean }
  | { kind: "accessor"; get: Atom; set: Atom; configurable: boolean; enumerable: boolean };

type Internal =
  | { kind: "ordinary" | "callable-opaque" }
  | { kind: "array"; length: number }
  | { kind: "buffer"; bytes: number[] }
  | { kind: "Float32Array"; buffer: Atom; byteOffset: number; byteLength: number; length: number }
  | { kind: "map"; entries: [Atom, Atom][] }
  | { kind: "set"; values: Atom[] }
  | { kind: "regexp"; source: string; flags: string }
  | { kind: "error" };

type Node = {
  kind: string;
  prototype: Atom;
  extensible: boolean;
  properties: { key: string | { tag: "symbol"; id: number }; descriptor: Descriptor }[];
  internal: Internal;
};

type SymbolNode = {
  category: "local" | "global" | "well-known";
  name: string | null;
  description: string | { tag: "undefined" };
};

export type RawGraph = { root: Atom; nodes: Node[]; symbols: SymbolNode[] };

const intrinsicNames = new Map<object, string>([
  [Object.prototype, "Object.prototype"],
  [Array.prototype, "Array.prototype"],
  [Function.prototype, "Function.prototype"],
  [Object.getPrototypeOf(async function observerAsync() {}), "AsyncFunction.prototype"],
  [Map.prototype, "Map.prototype"],
  [Set.prototype, "Set.prototype"],
  [RegExp.prototype, "RegExp.prototype"],
  [ArrayBuffer.prototype, "ArrayBuffer.prototype"],
  [Float32Array.prototype, "Float32Array.prototype"],
  [Object.getPrototypeOf(Float32Array.prototype), "TypedArray.prototype"],
  [Error.prototype, "Error.prototype"],
  [TypeError.prototype, "TypeError.prototype"],
  [RangeError.prototype, "RangeError.prototype"],
  [ReferenceError.prototype, "ReferenceError.prototype"],
  [SyntaxError.prototype, "SyntaxError.prototype"],
  [EvalError.prototype, "EvalError.prototype"],
  [URIError.prototype, "URIError.prototype"],
  [AggregateError.prototype, "AggregateError.prototype"]
]);

const wellKnownSymbols = new Map<symbol, string>();
for (const name of Object.getOwnPropertyNames(Symbol)) {
  const descriptor = Object.getOwnPropertyDescriptor(Symbol, name);
  if (descriptor && "value" in descriptor && typeof descriptor.value === "symbol") {
    wellKnownSymbols.set(descriptor.value, name);
  }
}

function intrinsicGetter(prototype: object, key: string, receiver: object): unknown {
  const getter = Object.getOwnPropertyDescriptor(prototype, key)?.get;
  if (!getter) throw new Error("Missing observer intrinsic: " + key);
  return Reflect.apply(getter, receiver, []);
}

export function observeArrayGraph(value: unknown): RawGraph {
  const nodes: Node[] = [];
  const symbols: SymbolNode[] = [];
  const seen = new WeakMap<object, number>();
  const seenSymbols = new Map<symbol, number>();
  let descriptors = 0;
  let bufferBytes = 0;
  function chargeDescriptor(): void {
    descriptors += 1;
    if (descriptors > 65536) throw new Error("OBSERVER_LIMIT: descriptors");
  }
  function symbolReference(value: symbol): { tag: "symbol"; id: number } {
    const previous = seenSymbols.get(value);
    if (previous !== undefined) return { tag: "symbol", id: previous };
    const id = symbols.length;
    if (id >= 8192) throw new Error("OBSERVER_LIMIT: symbols");
    seenSymbols.set(value, id);
    const wellKnown = wellKnownSymbols.get(value);
    const global = Symbol.keyFor(value);
    symbols.push({
      category: wellKnown !== undefined ? "well-known" : global !== undefined ? "global" : "local",
      name: wellKnown ?? global ?? null,
      description: value.description ?? { tag: "undefined" }
    });
    return { tag: "symbol", id };
  }
  function visit(entry: unknown, depth: number): Atom {
    if (depth > 128) throw new Error("OBSERVER_LIMIT: depth");
    if (entry === null || typeof entry === "boolean" || typeof entry === "string") return entry;
    if (entry === undefined) return { tag: "undefined" };
    if (typeof entry === "number") {
      if (Object.is(entry, -0)) return { tag: "number", value: "-0" };
      return Number.isFinite(entry) ? entry : { tag: "number", value: String(entry) };
    }
    if (typeof entry === "bigint") return { tag: "bigint", value: String(entry) };
    if (typeof entry === "symbol") return symbolReference(entry);
    if (typeof entry !== "object" && typeof entry !== "function")
      throw new Error("Unsupported observer atom");
    const intrinsic = intrinsicNames.get(entry);
    if (intrinsic !== undefined) return { tag: "intrinsic", name: intrinsic };
    const previous = seen.get(entry);
    if (previous !== undefined) return { tag: "ref", id: previous };
    if (nodes.length >= 8192) throw new Error("OBSERVER_LIMIT: nodes");
    if (
      entry instanceof Promise ||
      entry instanceof WeakMap ||
      entry instanceof WeakSet ||
      entry instanceof Date
    ) {
      throw new Error("Unsupported live/internal observer brand");
    }
    const id = nodes.length;
    seen.set(entry, id);
    const node: Node = {
      kind: typeof entry === "function" ? "callable" : Array.isArray(entry) ? "array" : "object",
      prototype: null,
      extensible: Object.isExtensible(entry),
      properties: [],
      internal: { kind: "ordinary" }
    };
    nodes.push(node);
    node.prototype = visit(Object.getPrototypeOf(entry), depth + 1);
    if (typeof entry === "function") node.internal = { kind: "callable-opaque" };
    else if (Array.isArray(entry)) node.internal = { kind: "array", length: entry.length };
    else if (entry instanceof ArrayBuffer) {
      const length = intrinsicGetter(ArrayBuffer.prototype, "byteLength", entry);
      if (typeof length !== "number") throw new Error("Invalid buffer length");
      bufferBytes += length;
      if (bufferBytes > 1048576) throw new Error("OBSERVER_LIMIT: buffer bytes");
      node.kind = "ArrayBuffer";
      node.internal = { kind: "buffer", bytes: Array.from(new Uint8Array(entry)) };
    } else if (ArrayBuffer.isView(entry)) {
      if (!(entry instanceof Float32Array)) throw new Error("Unsupported observer typed view");
      const prototype = Object.getPrototypeOf(Float32Array.prototype);
      const buffer = intrinsicGetter(prototype, "buffer", entry);
      const byteOffset = intrinsicGetter(prototype, "byteOffset", entry);
      const byteLength = intrinsicGetter(prototype, "byteLength", entry);
      const length = intrinsicGetter(prototype, "length", entry);
      if (
        !(buffer instanceof ArrayBuffer) ||
        typeof byteOffset !== "number" ||
        typeof byteLength !== "number" ||
        typeof length !== "number"
      ) {
        throw new Error("Invalid observer typed view storage");
      }
      node.kind = "Float32Array";
      node.internal = {
        kind: "Float32Array",
        buffer: visit(buffer, depth + 1),
        byteOffset,
        byteLength,
        length
      };
    } else if (entry instanceof Map) {
      const entries: [Atom, Atom][] = [];
      Map.prototype.forEach.call(entry, (value: unknown, key: unknown) => {
        chargeDescriptor();
        entries.push([visit(key, depth + 1), visit(value, depth + 1)]);
      });
      node.kind = "Map";
      node.internal = { kind: "map", entries };
    } else if (entry instanceof Set) {
      const values: Atom[] = [];
      Set.prototype.forEach.call(entry, (value: unknown) => {
        chargeDescriptor();
        values.push(visit(value, depth + 1));
      });
      node.kind = "Set";
      node.internal = { kind: "set", values };
    } else if (entry instanceof RegExp) {
      const source = intrinsicGetter(RegExp.prototype, "source", entry);
      if (typeof source !== "string") throw new Error("Invalid observer regexp source");
      let flags = "";
      for (const [name, flag] of [
        ["hasIndices", "d"],
        ["global", "g"],
        ["ignoreCase", "i"],
        ["multiline", "m"],
        ["dotAll", "s"],
        ["unicode", "u"],
        ["unicodeSets", "v"],
        ["sticky", "y"]
      ]) {
        if (
          Object.getOwnPropertyDescriptor(RegExp.prototype, name)?.get &&
          intrinsicGetter(RegExp.prototype, name, entry)
        )
          flags += flag;
      }
      node.kind = "RegExp";
      node.internal = { kind: "regexp", source, flags };
    } else if (entry instanceof Error) {
      node.kind = "Error";
      node.internal = { kind: "error" };
    }
    for (const key of Reflect.ownKeys(entry)) {
      chargeDescriptor();
      const descriptor = Object.getOwnPropertyDescriptor(entry, key);
      if (!descriptor) throw new Error("Own property disappeared during observation");
      const common = {
        configurable: descriptor.configurable === true,
        enumerable: descriptor.enumerable === true
      };
      node.properties.push({
        key: typeof key === "symbol" ? symbolReference(key) : key,
        descriptor:
          "value" in descriptor
            ? {
                kind: "data",
                ...common,
                writable: descriptor.writable === true,
                value: visit(descriptor.value, depth + 1)
              }
            : {
                kind: "accessor",
                ...common,
                get: visit(descriptor.get, depth + 1),
                set: visit(descriptor.set, depth + 1)
              }
      });
    }
    return { tag: "ref", id };
  }
  const graph = { root: visit(value, 0), nodes, symbols };
  if (Buffer.byteLength(JSON.stringify(graph), "utf8") > 8388608)
    throw new Error("OBSERVER_LIMIT: capture bytes");
  return graph;
}
