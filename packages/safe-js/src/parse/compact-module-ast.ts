import { SandboxError } from "../interp/budget.js";
import { CompactSourcePositions } from "./compact-spans.js";
import {
  dynamicNodeSources,
  type DynamicSource,
  functionSources,
  functionStrictness,
  templateSources
} from "./function-source.js";
import type { ParseResult, SourceSpan } from "./parser.js";

const chunkLength = 65536;
const scalarMask = 0x0fffffff;
const handles = new WeakMap<object, CodeRecord>();
const mutableRecord = Symbol("compiler record writability");
type Shape = {
  keys: string[];
  descriptors: PropertyDescriptorMap;
  create: () => object;
};

const recordToken = Symbol("compiler traversal authority");
const defineCompilerProperty = Reflect.defineProperty;
const NativeRowMap = Map;
const nativeIndexMap = {
  get: Function.prototype.call.bind(Map.prototype.get) as <K, V>(
    map: Map<K, V>,
    key: K
  ) => V | undefined,
  has: Function.prototype.call.bind(Map.prototype.has) as <K, V>(map: Map<K, V>, key: K) => boolean,
  set: Function.prototype.call.bind(Map.prototype.set) as <K, V>(
    map: Map<K, V>,
    key: K,
    value: V
  ) => Map<K, V>,
  delete: Function.prototype.call.bind(Map.prototype.delete) as <K, V>(
    map: Map<K, V>,
    key: K
  ) => boolean,
  clear: Function.prototype.call.bind(Map.prototype.clear) as <K, V>(map: Map<K, V>) => void,
  keys: Function.prototype.call.bind(Map.prototype.keys) as <K, V>(
    map: Map<K, V>
  ) => MapIterator<K>,
  size: Function.prototype.call.bind(
    Object.getOwnPropertyDescriptor(Map.prototype, "size")!.get!
  ) as <K, V>(map: Map<K, V>) => number
};

/** Private compiler traversal handle; never a guest-visible AST value. */
class CodeRecord {
  #brand = true;
  static authentic(value: object): value is CodeRecord {
    return #brand in value && value.#brand;
  }
  constructor(
    token: symbol,
    readonly owner: CompactModuleAst,
    readonly row: number
  ) {
    if (token !== recordToken) throw new TypeError("Foreign compiler traversal authority.");
    Object.freeze(this);
  }
}

function record(value: unknown): CodeRecord | undefined {
  if (value === null || typeof value !== "object") return undefined;
  return CodeRecord.authentic(value) ? value : handles.get(value);
}

/** Source-local numeric storage. Decoded identities and mutations stay retained. */
export class CompactModuleAst {
  private readonly chunks: Uint32Array[] = [];
  private readonly shapes: Shape[] = [];
  private readonly shapeIDs = new Map<string, number>();
  private readonly strings: string[] = [];
  private readonly stringIDs = new Map<string, number>();
  private readonly numbers: number[] = [];
  private readonly cache = new Map<number, object>();
  private readonly boundaries = new Set<number>();
  private readonly persistentBoundaries = new Set<number>();
  private readonly overrides = new WeakMap<object, Map<string, unknown>>();
  private finished = false;
  private readonly positions: CompactSourcePositions;
  private readonly maxWords: number;
  private used = 0;
  private bodies = 0;
  private dynamicSource?: DynamicSource;

  constructor(private readonly source: string) {
    this.positions = new CompactSourcePositions(source);
    this.maxWords = Math.min(scalarMask - 1, Math.max(1024, source.length * 24 + 1024));
  }

  statistics() {
    return {
      words: this.used,
      bufferBytes: this.chunks.reduce((sum, c) => sum + c.byteLength, 0),
      bodies: this.bodies,
      materializedRecords: this.cache.size,
      strings: this.strings.length
    };
  }

  finish(): void {
    this.finished = true;
    if (this.chunks.length) {
      const last = this.chunks.length - 1;
      this.chunks[last] = this.chunks[last]!.slice(0, ((this.used - 1) % chunkLength) + 1);
    }
    this.stringIDs.clear();
    this.shapeIDs.clear();
    // Parser transfers consult this set; finished storage can no longer pack.
    this.persistentBoundaries.clear();
  }

  /** Retirement consumes unobserved parser arrays after syntax validation. */
  pack<T extends object>(root: T, body = true, retire = false, persistent = true): T {
    if (this.finished) throw new TypeError("Compiler body storage is finished.");
    const seen = new WeakMap<object, number>();
    const pending: Array<{
      row: number;
      kind: number;
      values: unknown[];
      index: number;
      bodyIndex?: number;
    }> = [];
    const encode = (value: unknown): number => {
      if (value === null || typeof value !== "object") return this.scalar(value);
      const existing = record(value);
      if (existing?.owner === this) {
        // Parser-only transfer: no caller has observed these temporary roots.
        if (retire && !this.overrides.has(value)) {
          this.cache.delete(existing.row);
          if (!this.persistentBoundaries.has(existing.row)) this.boundaries.delete(existing.row);
        }
        return existing.row + 1;
      }
      const previous = seen.get(value);
      if (previous !== undefined) return previous + 1;
      let kind: number,
        row: number,
        values: unknown[] = [];
      const array = Array.isArray(value);
      const keys = array ? [] : Object.keys(value).filter((key) => key !== "nodeId");
      if (array) {
        kind = 0;
        row = this.reserve(2 + value.length);
        values = value;
        this.write(row, kind);
        this.write(row + 1, value.length);
      } else if (keys.length === 2 && keys[0] === "start" && keys[1] === "end") {
        const span = value as SourceSpan,
          start = span.start,
          end = span.end;
        const startMatches = this.positions.matchesPosition(start);
        const endMatches = this.positions.matchesPosition(end);
        if (startMatches && endMatches) {
          kind = 1;
          row = this.reserve(3);
          this.write(row, kind);
          this.write(row + 1, start.offset);
          this.write(row + 2, end.offset);
        } else {
          kind = 2;
          row = this.reserve(7);
          this.write(row, kind);
          [start.line, start.column, start.offset, end.line, end.column, end.offset].forEach(
            (n, i) => this.write(row + 1 + i, n)
          );
        }
      } else {
        values = keys.map((key) => (value as Record<string, unknown>)[key]);
        if (
          "nodeId" in value ||
          (typeof (value as { type?: unknown }).type === "string" && "span" in value)
        ) {
          keys.push("@id");
          values.push((value as { nodeId?: number }).nodeId);
          const metadata = functionSources.get(value as Parameters<typeof functionSources.get>[0]);
          if (metadata) {
            if (metadata.text !== this.source)
              throw new TypeError("Foreign compiler function source.");
            keys.push("@start", "@end", "@strict");
            values.push(
              metadata.start,
              metadata.end,
              functionStrictness.get(value as Parameters<typeof functionStrictness.get>[0])
            );
          }
          const template = templateSources.get(value as Parameters<typeof templateSources.get>[0]);
          if (template !== undefined) {
            if (template !== this.source) throw new TypeError("Foreign compiler template source.");
            keys.push("@template");
            values.push(true);
          }
        }
        const key = JSON.stringify(keys);
        let shape = this.shapeIDs.get(key);
        if (shape === undefined) {
          shape = this.shapes.length;
          this.shapes.push(this.shape(keys));
          this.shapeIDs.set(key, shape);
        }
        kind = shape + 3;
        row = this.reserve(1 + values.length);
        this.write(row, kind);
      }
      seen.set(value, row);
      // Linking reads declarator binding names, but must leave initializers packed.
      if ((value as { type?: unknown }).type === "VariableDeclarator") {
        this.boundaries.add(row);
        this.persistentBoundaries.add(row);
      }
      if (kind === 0 || kind >= 3) {
        const type = (value as { type?: unknown }).type;
        const bodyIndex = [
          "FunctionDeclaration",
          "FunctionExpression",
          "ArrowFunctionExpression"
        ].includes(String(type))
          ? keys.indexOf("body")
          : -1;
        pending.push({
          row,
          kind,
          values,
          index: 0,
          bodyIndex: bodyIndex >= 0 ? bodyIndex : undefined
        });
      }
      return row + 1;
    };
    const reference = encode(root);
    while (pending.length) {
      const frame = pending[pending.length - 1]!;
      if (frame.index === frame.values.length) {
        pending.pop();
        continue;
      }
      // Complete each descendant before retaining another sibling's fields.
      const index = frame.index++;
      const child = encode(frame.values[index]);
      if (retire && frame.kind === 0)
        defineCompilerProperty(frame.values, index, { value: undefined });
      this.write(frame.row + (frame.kind === 0 ? 2 : 1) + index, child);
      if (index === frame.bodyIndex && child >>> 28 === 0) {
        this.boundaries.add(child - 1);
        this.persistentBoundaries.add(child - 1);
      }
    }
    this.boundaries.add(reference - 1);
    if (persistent) this.persistentBoundaries.add(reference - 1);
    if (body) this.bodies++;
    return this.decode(reference) as T;
  }

  /** Install source metadata and index numeric rows without publishing every node. */
  dynamicNodes(root: number, source: DynamicSource): Map<number, ParseResult> {
    if (!this.finished) throw new TypeError("Unfinished compiler storage.");
    if (source.body !== this.source) throw new TypeError("Foreign compiler dynamic source text.");
    if (this.dynamicSource && this.dynamicSource !== source)
      throw new TypeError("Foreign compiler dynamic source owner.");
    this.dynamicSource = source;
    const rows = new NativeRowMap<number, number>(),
      seen = new Set<number>(),
      pending = [root];
    while (pending.length) {
      const row = pending.pop()!;
      if (seen.has(row)) continue;
      seen.add(row);
      const kind = this.read(row);
      if (kind === 0) {
        for (let i = 0, n = this.read(row + 1); i < n; i++) {
          const ref = this.read(row + 2 + i);
          if (ref >>> 28 === 0) pending.push((ref & scalarMask) - 1);
        }
      } else if (kind >= 3) {
        const keys = this.shapes[kind - 3]!.keys;
        const idIndex = keys.indexOf("@id"),
          typeIndex = keys.indexOf("type");
        if (idIndex >= 0 && typeIndex >= 0) {
          const id = this.decode(this.read(row + 1 + idIndex));
          const type = this.decode(this.read(row + 1 + typeIndex));
          if (typeof id === "number" && type !== "Module") nativeIndexMap.set(rows, id, row);
        }
        for (let i = 0; i < keys.length; i++) {
          if (keys[i]!.startsWith("@")) continue;
          const ref = this.read(row + 1 + i);
          if (ref >>> 28 === 0) pending.push((ref & scalarMask) - 1);
        }
      }
    }
    for (const node of this.cache.values()) {
      const id = (node as { nodeId?: unknown }).nodeId;
      if (typeof id === "number" && nativeIndexMap.has(rows, id))
        dynamicNodeSources.set(node, source);
    }
    return new CompactNodeIndex(recordToken, rows, (row) => this.object(row) as ParseResult);
  }

  private scalar(value: unknown): number {
    if (value === undefined) return 0x10000000;
    if (value === null) return 0x20000000;
    if (typeof value === "boolean") return 0x30000000 + (value ? 1 : 0);
    if (typeof value === "string") {
      let id = this.stringIDs.get(value);
      if (id === undefined) {
        id = this.strings.length;
        this.strings.push(value);
        this.stringIDs.set(value, id);
      }
      return 0x40000000 + id;
    }
    if (typeof value === "number") {
      if (Number.isInteger(value) && !Object.is(value, -0) && Math.abs(value) <= scalarMask)
        return (value < 0 ? 0x60000000 : 0x50000000) + Math.abs(value);
      const id = this.numbers.length;
      this.numbers.push(value);
      return 0x70000000 + id;
    }
    throw new TypeError("Unsupported compiler scalar.");
  }

  private reserve(length: number): number {
    const row = this.used,
      next = row + length;
    if (next > this.maxWords)
      throw new SandboxError({
        budget: "dataSize",
        current: next,
        limit: this.maxWords
      });
    this.used = next;
    this.write(next - 1, 0);
    return row;
  }
  private read(index: number): number {
    return this.chunks[Math.floor(index / chunkLength)]![index % chunkLength]!;
  }
  private write(index: number, value: number): void {
    const chunk = Math.floor(index / chunkLength);
    this.chunks[chunk] ??= new Uint32Array(chunkLength);
    this.chunks[chunk]![index % chunkLength] = value;
  }

  private decode(reference: number, raw = false): unknown {
    const tag = reference >>> 28,
      payload = reference & scalarMask;
    switch (tag) {
      case 0:
        return raw ? new CodeRecord(recordToken, this, payload - 1) : this.object(payload - 1);
      case 1:
        return undefined;
      case 2:
        return null;
      case 3:
        return payload !== 0;
      case 4:
        return this.strings[payload];
      case 5:
        return payload;
      case 6:
        return -payload;
      case 7:
        return this.numbers[payload];
      default:
        throw new TypeError("Invalid compiler reference.");
    }
  }

  private shape(keys: string[]): Shape {
    const descriptors: PropertyDescriptorMap = {};
    // Accessors have a different receiver, so capture their source-local owner.
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const owner = this;
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i]!;
      if (key === "@id") {
        // ID assignment updates a data field instead of replacing an accessor.
        descriptors.nodeId = {
          value: undefined,
          writable: true,
          enumerable: false,
          configurable: true
        };
        continue;
      }
      if (key.startsWith("@")) continue;
      const name = key;
      descriptors[name] = {
        enumerable: key !== "@id",
        configurable: true,
        get(this: object) {
          const handle = handles.get(this);
          if (
            handle?.owner !== owner ||
            owner.shapes[owner.read(handle.row) - 3]?.descriptors !== descriptors
          )
            throw new TypeError("Foreign compiler record receiver.");
          const assigned = owner.overrides.get(this);
          return assigned?.has(name)
            ? assigned.get(name)
            : owner.decode(owner.read(handle.row + 1 + i));
        },
        set(this: object, value: unknown) {
          const handle = handles.get(this);
          if (
            handle?.owner !== owner ||
            owner.shapes[owner.read(handle.row) - 3]?.descriptors !== descriptors
          )
            throw new TypeError("Foreign compiler record receiver.");
          if (Object.isFrozen(this))
            throw new TypeError("Cannot assign to a frozen compiler record.");
          let assigned = owner.overrides.get(this);
          if (!assigned) {
            assigned = new Map();
            owner.overrides.set(this, assigned);
          }
          assigned.set(name, value);
        }
      };
    }
    descriptors[mutableRecord] = {
      value: true,
      writable: true,
      configurable: true
    };
    // Each accessor layout has its own allocation map, while AST prototypes stay plain.
    function CompilerRecord(this: object) {
      Object.defineProperties(this, descriptors);
    }
    CompilerRecord.prototype = Object.prototype;
    return {
      keys,
      descriptors,
      create: () => Reflect.construct(CompilerRecord, []) as object
    };
  }

  private attachMetadata(output: object, row: number, shape: Shape): void {
    const metadata = (name: string) => {
      const index = shape.keys.indexOf(name);
      return index < 0 ? undefined : this.decode(this.read(row + 1 + index));
    };
    const id = metadata("@id");
    if (id !== undefined && this.dynamicSource && shape.keys.includes("type")) {
      const type = metadata("type");
      if (type !== "Module") dynamicNodeSources.set(output, this.dynamicSource);
    }
    if (id !== undefined)
      Object.defineProperty(output, "nodeId", {
        value: id,
        writable: true,
        enumerable: false,
        configurable: true
      });
    const start = metadata("@start");
    if (start !== undefined) {
      functionSources.set(output as Parameters<typeof functionSources.set>[0], {
        text: this.source,
        start: start as number,
        end: metadata("@end") as number
      });
      const strict = metadata("@strict");
      if (strict !== undefined)
        functionStrictness.set(
          output as Parameters<typeof functionStrictness.set>[0],
          strict as boolean
        );
    }
    if (metadata("@template") === true)
      templateSources.set(output as Parameters<typeof templateSources.set>[0], this.source);
  }

  private object(row: number): object {
    const cached = this.cache.get(row);
    if (cached !== undefined) return cached;
    const tasks: Array<{ row: number; kind: number; output: object }> = [];
    const make = (index: number): object => {
      const cached = this.cache.get(index);
      if (cached) return cached;
      const kind = this.read(index);
      let output: object;
      if (kind === 0) {
        const array: unknown[] = [];
        array.length = this.read(index + 1);
        output = array;
        tasks.push({ row: index, kind, output });
      } else if (kind === 1)
        output = this.positions.span(this.read(index + 1), this.read(index + 2));
      else if (kind === 2)
        output = {
          start: {
            line: this.read(index + 1),
            column: this.read(index + 2),
            offset: this.read(index + 3)
          },
          end: {
            line: this.read(index + 4),
            column: this.read(index + 5),
            offset: this.read(index + 6)
          }
        };
      else {
        const shape = this.shapes[kind - 3]!;
        if (this.boundaries.has(index)) {
          output = shape.create();
          handles.set(output, new CodeRecord(recordToken, this, index));
          this.attachMetadata(output, index, shape);
        } else {
          output = {};
          tasks.push({ row: index, kind, output });
        }
      }
      this.cache.set(index, output);
      if (!this.finished) handles.set(output, new CodeRecord(recordToken, this, index));
      return output;
    };
    const value = (ref: number): unknown =>
      ref >>> 28 === 0 ? make((ref & scalarMask) - 1) : this.decode(ref);
    const output = make(row);
    while (tasks.length) {
      const { row: index, kind, output: target } = tasks.pop()!;
      if (kind === 0) {
        const array = target as unknown[];
        for (let i = 0; i < array.length; i++) array[i] = value(this.read(index + 2 + i));
      } else {
        const shape = this.shapes[kind - 3]!;
        for (let i = 0; i < shape.keys.length; i++) {
          const key = shape.keys[i]!;
          if (!key.startsWith("@"))
            Object.defineProperty(target, key, {
              value: value(this.read(index + 1 + i)),
              writable: true,
              enumerable: true,
              configurable: true
            });
        }
        this.attachMetadata(target, index, shape);
      }
    }
    return output;
  }

  // Compiler passes use these private-owner records, not the decoded AST cache.
  isArray(row: number): boolean {
    return this.read(row) === 0;
  }
  *entries(row: number): Iterable<[string, unknown]> {
    const kind = this.read(row),
      cached = this.cache.get(row);
    if (cached) {
      for (const key of Object.keys(cached)) yield [key, this.field(row, key)];
      return;
    }
    if (kind === 0) {
      for (let i = 0, n = this.read(row + 1); i < n; i++)
        yield [String(i), this.decode(this.read(row + 2 + i), true)];
    } else if (kind === 1) {
      yield ["start", this.positions.position(this.read(row + 1))];
      yield ["end", this.positions.position(this.read(row + 2))];
    } else if (kind === 2) {
      yield [
        "start",
        {
          line: this.read(row + 1),
          column: this.read(row + 2),
          offset: this.read(row + 3)
        }
      ];
      yield [
        "end",
        {
          line: this.read(row + 4),
          column: this.read(row + 5),
          offset: this.read(row + 6)
        }
      ];
    } else if (kind >= 3) {
      const keys = this.shapes[kind - 3]!.keys;
      for (let i = 0; i < keys.length; i++) {
        const key = keys[i]!;
        if (!key.startsWith("@")) yield [key, this.decode(this.read(row + 1 + i), true)];
      }
    }
  }
  field(row: number, key: string): unknown {
    const kind = this.read(row),
      cached = this.cache.get(row);
    if (cached) {
      const descriptor = Object.getOwnPropertyDescriptor(cached, key);
      if (!descriptor) return undefined;
      if ("value" in descriptor) return descriptor.value;
      const assigned = this.overrides.get(cached);
      if (assigned?.has(key)) return assigned.get(key);
      if (kind < 3) return Reflect.get(cached, key);
      if (descriptor.get !== this.shapes[kind - 3]!.descriptors[key]?.get)
        return Reflect.get(cached, key);
    }
    if (kind < 3) return undefined;
    const keys = this.shapes[kind - 3]!.keys,
      index = keys.indexOf(key === "nodeId" ? "@id" : key);
    return index < 0 ? undefined : this.decode(this.read(row + 1 + index), true);
  }
  assignId(row: number, id: number): void {
    const keys = this.shapes[this.read(row) - 3]!.keys,
      index = keys.indexOf("@id");
    if (index < 0) throw new TypeError("Compiler record is not an AST node.");
    this.write(row + 1 + index, this.scalar(id));
    const cached = this.cache.get(row);
    if (cached)
      Object.defineProperty(cached, "nodeId", {
        value: id,
        writable: true,
        enumerable: false,
        configurable: true
      });
  }
  offsets(row: number): [number, number] | undefined {
    const span = this.field(row, "span");
    if (!(span instanceof CodeRecord)) return undefined;
    const kind = this.read(span.row);
    return kind === 1
      ? [this.read(span.row + 1), this.read(span.row + 2)]
      : kind === 2
        ? [this.read(span.row + 3), this.read(span.row + 6)]
        : undefined;
  }
}

export function compilerField(value: unknown, key: string): unknown {
  const handle = record(value);
  return handle
    ? handle.owner.field(handle.row, key)
    : value !== null && typeof value === "object"
      ? (value as Record<string, unknown>)[key]
      : undefined;
}
export function compilerIsArray(value: unknown): boolean {
  const handle = record(value);
  return handle ? handle.owner.isArray(handle.row) : Array.isArray(value);
}
export function* compilerEntries(value: object): Iterable<[string, unknown]> {
  const handle = record(value);
  if (handle) yield* handle.owner.entries(handle.row);
  else yield* Object.entries(value);
}
export function* compilerElements(value: unknown): Iterable<unknown> {
  if (value === null || typeof value !== "object") return;
  if (Array.isArray(value)) {
    yield* value;
    return;
  }
  for (const [, child] of compilerEntries(value)) yield child;
}
export function compilerAssignId(value: object, id: number): void {
  const handle = record(value);
  if (handle) handle.owner.assignId(handle.row, id);
  else
    Object.defineProperty(value, "nodeId", {
      value: id,
      writable: true,
      enumerable: false,
      configurable: true
    });
}
export function compilerOffsets(value: unknown): [number, number] | undefined {
  const handle = record(value);
  if (handle) return handle.owner.offsets(handle.row);
  const span = compilerField(value, "span") as SourceSpan | undefined;
  return span ? [span.start.offset, span.end.offset] : undefined;
}
export function compactAstStatistics(value: object) {
  return record(value)?.owner.statistics();
}

/** Internal source index; row authority remains hidden from native Map hooks. */
class CompactNodeIndex extends Map<number, ParseResult> {
  #rows: Map<number, number>;
  #decode: (row: number) => ParseResult;
  constructor(token: symbol, rows: Map<number, number>, decode: (row: number) => ParseResult) {
    super();
    if (token !== recordToken) throw new TypeError("Foreign compiler index authority.");
    this.#rows = rows;
    this.#decode = decode;
  }
  override get size(): number {
    return nativeIndexMap.size(this.#rows);
  }
  override has(key: number): boolean {
    return nativeIndexMap.has(this.#rows, key);
  }
  override get(key: number): ParseResult | undefined {
    if (nativeIndexMap.has(this, key)) return nativeIndexMap.get(this, key);
    const row = nativeIndexMap.get(this.#rows, key);
    return row === undefined ? undefined : this.#decode(row);
  }
  override set(key: number, value: ParseResult): this {
    if (!nativeIndexMap.has(this.#rows, key)) nativeIndexMap.set(this.#rows, key, -1);
    nativeIndexMap.set(this, key, value);
    return this;
  }
  override delete(key: number): boolean {
    nativeIndexMap.delete(this, key);
    return nativeIndexMap.delete(this.#rows, key);
  }
  override clear(): void {
    nativeIndexMap.clear(this);
    nativeIndexMap.clear(this.#rows);
  }
  override keys(): MapIterator<number> {
    return nativeIndexMap.keys(this.#rows);
  }
  override *values(): MapIterator<ParseResult> {
    for (const key of this.keys()) yield this.get(key)!;
  }
  override *entries(): MapIterator<[number, ParseResult]> {
    for (const key of this.keys()) yield [key, this.get(key)!];
  }
  override [Symbol.iterator](): MapIterator<[number, ParseResult]> {
    return this.entries();
  }
  override forEach(
    callback: (value: ParseResult, key: number, map: Map<number, ParseResult>) => void,
    thisArg?: unknown
  ): void {
    for (const [key, value] of this) callback.call(thisArg, value, key, this);
  }
}

export function compactDynamicNodes(
  root: object,
  source: DynamicSource
): Map<number, ParseResult> | undefined {
  const handle = record(root);
  return handle?.owner.dynamicNodes(handle.row, source);
}
