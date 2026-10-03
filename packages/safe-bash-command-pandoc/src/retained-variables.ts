import {PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {BackedText, type TextRange} from "./backed-text.js";
import type {ExecutionContext} from "./execution.js";
import type {MetadataObject, MetadataValue, WorkingStorageOptions} from "./types.js";

/** Snapshot the caller-owned JSON option map without cloning its value graph.
 * Reflection needs one immediate Object.keys list and property access needs one
 * complete key. These API-input costs are separate from the backed value tape,
 * key lists and traversal continuations used after admission. */
export class RetainedVariables {
  readonly tree: BackedJson;
  private closing: Promise<void> | undefined;
  private readonly release: () => void;
  private constructor(private readonly storage: PagedStorage, private readonly context: ExecutionContext) {
    this.tree = new BackedJson(storage, units => context.cooperate(units));
    this.release = context.onClose(() => this.close());
  }
  static async acquire(value: MetadataObject, context: ExecutionContext, working: WorkingStorageOptions, scratch: PagedStorage): Promise<RetainedVariables> {
    const result = new RetainedVariables(new PagedStorage({fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal}, (working.cacheBytes ?? 1048576) / 16384), context);
    try {await result.snapshot(value, scratch); return result;}
    catch (error) {try {await result.close();} catch { /* Preserve admission failure. */ } throw error;}
  }
  close(): Promise<void> {
    this.closing ??= this.storage.close().finally(this.release);
    return this.closing;
  }
  private async snapshot(root: MetadataObject, scratch: PagedStorage): Promise<void> {
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
    // Frames: parent, edge index, keys, count, next, metadata depth, array, temporary child link.
    const enter = async (value: MetadataObject | readonly MetadataValue[], parent: number, edge: number, level: number): Promise<number> => {
      context.bound("depth", level);
      const array = Array.isArray(value), position = scratch.allocate(64);
      let keys = 0, count = array ? value.length as number : 0;
      if (!array) {
        const names = Object.keys(value); count = names.length; keys = scratch.allocate(count * 24);
        for (let index = 0; index < count; index++) {
          const range = await text.from([names[index]!]); await put(keys + index * 24, [range.first, range.last, range.units]);
        }
      }
      await put(position, [parent, edge, keys, count, 0, level, array ? 1 : 0, 0]);
      await tree.begin(array ? "array" : "object"); return position;
    };
    const resolve = async (frame: number, candidate?: object): Promise<MetadataObject | readonly MetadataValue[]> => {
      let value: MetadataObject | readonly MetadataValue[] = root;
      if (value === candidate) context.fail("E_OPTION", "Invalid JSON metadata value");
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
        value = (value as Record<string | number, MetadataValue>)[key] as MetadataObject | readonly MetadataValue[];
        if (value === candidate) context.fail("E_OPTION", "Invalid JSON metadata value");
        child = next;
      }
      return value;
    };
    let frame = await enter(root, 0, 0, 0), current: MetadataObject | readonly MetadataValue[] = root;
    while (frame) {
      await context.cooperate();
      const fields = await get(frame, 8), [parent, , keys, count, index, level, array] = fields;
      if (index! >= count!) {
        await tree.end(); frame = parent!;
        if (frame) current = await resolve(frame);
        continue;
      }
      await put(frame + 32, [index! + 1]);
      const key = array ? index! : await keyAt(keys!, index!);
      const value = (current as Record<string | number, MetadataValue>)[key];
      if (!array) {
        context.charge("references", 1);
        if (key === "__proto__" || key === "constructor" || key === "prototype") context.fail("E_OPTION", "Unsafe metadata key");
        await tree.key(key as string);
      }
      if (value === null) {
        if (array) context.fail("E_OPTION", "Null metadata list elements are unsupported");
        await tree.value(null); continue;
      }
      context.bound("depth", level! + 1); context.charge("nodes", 1); await context.cooperate();
      if (typeof value === "string" || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) await tree.value(value);
      else if (value && typeof value === "object") {
        await resolve(frame, value);
        frame = await enter(value, frame, index!, level! + (Array.isArray(value) ? 1 : 2)); current = value;
      } else context.fail("E_OPTION", "Invalid JSON metadata value");
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
