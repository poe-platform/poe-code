import {PandocError} from "./errors.js";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {BackedText, type TextRange} from "./backed-text.js";
import type {ExecutionContext} from "./execution.js";
import type {WorkingStorageOptions} from "./types.js";

/** Snapshot the caller-owned JSON option map without cloning its value graph.
 * Reflection needs one immediate Object.keys list and property access needs one
 * complete key. These API-input costs are separate from the backed value tape,
 * key lists and traversal continuations used after admission. */
export class RetainedJsonOptions {
  readonly tree: BackedJson;
  private closing: Promise<void> | undefined;
  private readonly release: () => void;
  private constructor(private readonly storage: PagedStorage, private readonly context: ExecutionContext) {
    this.tree = new BackedJson(storage, units => context.cooperate(units));
    this.release = context.onClose(() => this.close());
  }
  static async acquire(value: object, context: ExecutionContext, working: WorkingStorageOptions, scratch: PagedStorage, layers: boolean | "ast" = false): Promise<RetainedJsonOptions> {
    const result = new RetainedJsonOptions(new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, (working.cacheBytes ?? 1048576) / 16384), context);
    try {await result.snapshot(value, scratch, layers); return result;}
    catch (error) {try {await result.close();} catch { /* Preserve admission failure. */ } throw error;}
  }
  close(): Promise<void> {
    this.closing ??= this.storage.close().finally(this.release);
    return this.closing;
  }
  private async snapshot(root: object, scratch: PagedStorage, layers: boolean | "ast"): Promise<void> {
    const context = this.context, tree = this.tree, text = new BackedText(scratch, units => context.cooperate(units));
    const put = async (position: number, fields: readonly number[]) => {
      const bytes = new Uint8Array(fields.length * 8), view = new DataView(bytes.buffer);
      fields.forEach((value, index) => view.setFloat64(index * 8, value, true));
      await scratch.write(position, bytes);
    };
    const get = async (position: number, count: number): Promise<number[]> => {
      const bytes = await scratch.read(position, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      return Array.from({length: count}, (_, index) => view.getFloat64(index * 8, true));
    };
    const keyAt = async (keys: number, index: number): Promise<string> => {
      const [first, last, units] = await get(keys + index * 24, 3);
      let key = ""; for await (const part of text.chunks({first: first!, last: last!, units: units!} satisfies TextRange)) key += part;
      return key;
    };
    const ast = layers === "ast";
    let cells = 0, attributes = 0, nodes = 0;
    const fail = async (frame: number, key?: string | number, message = "Invalid shape", code: "E_AST" | "E_LIMIT" = "E_AST"): Promise<never> => {
      let path = key === undefined ? "" : typeof key === "number" ? `[${key}]` : `.${key}`;
      for (let cursor = frame; cursor;) {
        const [parent, edge] = await get(cursor, 2);
        if (!parent) break;
        const fields = await get(parent, 8);
        path = (fields[6] ? `[${edge}]` : `.${await keyAt(fields[2]!, edge!)}`) + path;
        cursor = parent;
      }
      path = "$.metadata" + path;
      throw new PandocError(code, "convert", `${path}: ${message}`, undefined, path);
    };
    const reserveNode = async (frame: number, key?: string | number): Promise<void> => {
      if (++nodes > context.limits.nodes) await fail(frame, key, "AST budget exceeded", "E_LIMIT");
      context.charge("nodes", 1);
    };
    const unicode = async (value: string, frame: number, key?: string | number): Promise<void> => {
      for (let index = 0; index < value.length; index++) {
        if (index % 256 === 0) await context.cooperate();
        const unit = value.charCodeAt(index);
        if (unit >= 0xd800 && unit <= 0xdbff) {
          const next = value.charCodeAt(++index);
          if (!(next >= 0xdc00 && next <= 0xdfff)) await fail(frame, key, "Invalid Unicode");
        } else if (unit >= 0xdc00 && unit <= 0xdfff) await fail(frame, key, "Invalid Unicode");
      }
    };
    const property = async (value: object, key: string | number, frame: number): Promise<unknown> => {
      if (!ast) return (value as Record<string | number, unknown>)[key]!;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor) || !Array.isArray(value) && !descriptor.enumerable)
        return fail(frame, key, Array.isArray(value) ? "Accessor or sparse array" : "Invalid shape");
      return descriptor.value;
    };
    // Frames: parent, edge index, keys, count, next, metadata depth, array, temporary child link.
    const enter = async (value: object, parent: number, edge: number, level: number): Promise<number> => {
      if (!ast) context.bound("depth", level);
      const array = Array.isArray(value), position = scratch.allocate(64);
      let keys = 0, count = array ? value.length as number : 0;
      if (!array) {
        const names = ast ? Object.getOwnPropertyNames(value) : Object.keys(value); count = names.length; keys = scratch.allocate(count * 24);
        for (let index = 0; index < count; index++) {
          const range = await text.from([names[index]!]); await put(keys + index * 24, [range.first, range.last, range.units]);
        }
      }
      await put(position, [parent, edge, keys, count, 0, level, array ? 1 : 0, 0]);
      if (ast && level > context.limits.depth) await fail(position, undefined, "AST budget exceeded", "E_LIMIT");
      if (ast && !parent) await reserveNode(position);
      if (ast && array && nodes + count > context.limits.nodes) await fail(position, undefined, "AST budget exceeded", "E_LIMIT");
      if (ast && (array && Object.getOwnPropertySymbols(value).length || !array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) await fail(position);
      if (ast && array && (Number.isFinite(context.limits.tableCells) || Number.isFinite(context.limits.attributes) || Number.isFinite(context.limits.depth) || Number.isFinite(context.limits.nodes))) {
        // Normalization inspects every own array descriptor before recognizing
        // cell tuples, so accessors and sparse slots precede the budget charge.
        for (let i = 0; i < count; i++) {await property(value, i, position); await context.cooperate();}
        if (count === 3 && Number.isFinite(context.limits.attributes)) {
          const id = await property(value, 0, position), classes = await property(value, 1, position), pairs = await property(value, 2, position);
          if (typeof id === "string" && Array.isArray(classes) && Array.isArray(pairs)) {
            const units = 1 + classes.length + pairs.length;
            attributes += units;
            if (!Number.isSafeInteger(attributes) || attributes > context.limits.attributes) await fail(position, undefined, "AST budget exceeded", "E_LIMIT");
            context.charge("attributes", units);
          }
        }
        if (count === 5 && Array.isArray(await property(value, 0, position)) && typeof await property(value, 1, position) === "string") {
          const row = await property(value, 2, position), column = await property(value, 3, position);
          if (typeof row !== "number" || typeof column !== "number" || !Number.isSafeInteger(row) || !Number.isSafeInteger(column) || row < 1 || column < 1)
            await fail(position, undefined, "Invalid spans");
          const span = (row as number) * (column as number);
          cells += span;
          if (!Number.isSafeInteger(cells) || cells > context.limits.tableCells) await fail(position, undefined, "AST budget exceeded", "E_LIMIT");
          context.charge("tableCells", span);
        }
      }
      await tree.begin(array ? "array" : "object"); return position;
    };
    const resolve = async (frame: number, candidate?: object, candidateKey?: string | number): Promise<object> => {
      let value: object = root;
      if (value === candidate) {if (ast) await fail(frame, candidateKey, "Non-JSON or cyclic input"); context.fail("E_OPTION", "Invalid JSON metadata value");}
      let child = 0;
      for (let cursor = frame; cursor;) {
        await context.cooperate();
        await put(cursor + 56, [child]); child = cursor;
        cursor = (await get(cursor, 1))[0]!;
      }
      // Temporary forward links permit one root-to-leaf pass without an in-RAM path.
      while (child !== frame) {
        await context.cooperate();
        const parent = await get(child, 8), next = parent[7]!;
        const edge = (await get(next, 2))[1]!;
        const key = parent[6] ? edge : await keyAt(parent[2]!, edge);
        value = await property(value, key, child) as object;
        if (value === candidate) {if (ast) await fail(frame, candidateKey, "Non-JSON or cyclic input"); context.fail("E_OPTION", "Invalid JSON metadata value");}
        child = next;
      }
      return value;
    };
    if (ast) for (const [index, path] of ["$", "$", "$.blocks", "$"].entries()) {
      if (index === 1 && context.limits.depth < 1) throw new PandocError("E_LIMIT", "convert", "$: AST budget exceeded", undefined, "$");
      if (++nodes > context.limits.nodes) throw new PandocError("E_LIMIT", "convert", `${path}: AST budget exceeded`, undefined, path);
      context.charge("nodes", 1);
    }
    const rootFrame = await enter(root, 0, 0, ast ? 1 : 0);
    let frame = rootFrame, current: object = root;
    while (frame) {
      await context.cooperate();
      const fields = await get(frame, 8), [parent, , keys, count, index, level, array] = fields;
      if (index! >= count!) {
        if (ast && (array ? Object.keys(current).length !== count : Object.getOwnPropertySymbols(current).length > 0)) await fail(frame);
        await tree.end(); frame = parent!;
        if (frame) current = await resolve(frame);
        continue;
      }
      await put(frame + 32, [index! + 1]);
      const key = array ? index! : await keyAt(keys!, index!);
      if (ast && level! + 1 > context.limits.depth) await fail(frame, typeof key === "string" ? undefined : key, "AST budget exceeded", "E_LIMIT");
      if (ast && typeof key === "string") {await reserveNode(frame); await unicode(key, frame);}
      const value = await property(current, key, frame);
      if (!array) {
        context.charge("references", 1);
        if (key === "__proto__" || key === "constructor" || key === "prototype") {if (ast) await fail(frame, key); context.fail("E_OPTION", "Unsafe metadata key");}
        await tree.key(key as string);
      }
      if (ast) {await reserveNode(frame, key); if (typeof value === "string") await unicode(value, frame, key);}
      if (layers === true && frame === rootFrame) {
        if (value === null || typeof value !== "object" || Array.isArray(value)) context.fail("E_OPTION", "JSON metadata must be an object");
        await resolve(frame, value as object);
        frame = await enter(value as object, frame, index!, 0); current = value as object;
        continue;
      }
      if (value === null) {
        if (array && !ast) context.fail("E_OPTION", "Null metadata list elements are unsupported");
        await tree.value(null); continue;
      }
      if (!ast) {context.bound("depth", level! + 1); context.charge("nodes", 1);} await context.cooperate();
      if (typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) await tree.value(value);
      else if (value && typeof value === "object") {
        await resolve(frame, value, key);
        frame = await enter(value, frame, index!, level! + (ast || Array.isArray(value) ? 1 : 2)); current = value;
      } else {if (ast) await fail(frame, key, typeof value === "number" ? "Invalid shape" : "Non-JSON or cyclic input"); context.fail("E_OPTION", "Invalid JSON metadata value");}
    }
    if (ast) for (const path of ["$", "$.resources"]) {
      if (++nodes > context.limits.nodes) throw new PandocError("E_LIMIT", "convert", `${path}: AST budget exceeded`, undefined, path);
      context.charge("nodes", 1);
    }
  }
  async truthy(node: number): Promise<boolean> {
    const header = await this.tree.describe(node);
    if (header.kind === "object") return true;
    if (header.kind === "array") return header.children > 0;
    if (header.kind === "string") return header.end > node + 32;
    const value = await this.tree.smallText(node, 5);
    return value !== "null" && value !== "false" && value !== "0";
  }
  async *stringify(node: number): AsyncGenerator<string> {
    const finish = (await this.tree.describe(node)).end;
    while (node < finish) {
      await this.context.cooperate();
      const header = await this.tree.describe(node);
      if (header.kind === "object") this.context.fail("E_UNSUPPORTED_FEATURE", "Template map interpolation is unsupported");
      if (header.kind === "array") {node += 32; continue;}
      if (header.kind !== "literal" || await this.tree.smallText(node, 4) !== "null") yield* this.tree.scalarChunks(node);
      node = header.end;
    }
  }
}
