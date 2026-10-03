import {IntegerTable, PagedStorage} from "safe-bash-io-engine/storage";
import {BackedJson} from "./backed-json.js";
import {validateBackedPandoc} from "./backed-pandoc.js";
import {PandocError} from "./errors.js";
import type {ExecutionContext} from "./execution.js";
import type {ConversionOptions, WorkingStorageOptions} from "./types.js";

/** The caller owns the SDK graph. Admission retains keys and continuations in
 * storage; reflection still needs one immediate own-property-name vector and
 * property lookup needs one complete key. No cloned metadata graph is held. */
export async function retainTypedMetadata(root: NonNullable<ConversionOptions["metadata"]>, context: ExecutionContext, working: WorkingStorageOptions) {
  const owner = {fs: working.fs, cwd: working.directory, env: {}, signal: context.signal ?? new AbortController().signal};
  const pages = (working.cacheBytes ?? 1048576) / 16384;
  const storage = new PagedStorage(owner, pages), scratch = new PagedStorage(owner, pages), wire = new PagedStorage(owner, pages);
  let closing: Promise<void> | undefined;
  const close = () => closing ??= (async () => {
    let failure: {reason: unknown} | undefined;
    for (const store of [storage, scratch, wire]) try {await store.close();} catch (reason) {failure ??= {reason};}
    release(); if (failure) throw failure.reason;
  })();
  const release = context.onClose(close), cooperate = (units?: number) => context.cooperate(units);
  const tree = new BackedJson(storage, cooperate), result = new BackedJson(wire, cooperate);
  const put = async (at: number, fields: readonly number[]) => {
    const bytes = new Uint8Array(fields.length * 8), view = new DataView(bytes.buffer);
    fields.forEach((value, index) => view.setFloat64(index * 8, value, true)); await scratch.write(at, bytes);
  };
  const get = async (at: number, count: number) => {
    const bytes = await scratch.read(at, count * 8), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return Array.from({length: count}, (_, i) => view.getFloat64(i * 8, true));
  };
  const keyAt = async (at: number) => {
    const [start, length] = await get(at, 2); let value = "";
    for (let offset = 0; offset < length!; offset += 4096) {
      const bytes = await scratch.read(start! + offset * 2, Math.min(4096, length! - offset) * 2), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
      for (let i = 0; i < bytes.length; i += 2) value += String.fromCharCode(view.getUint16(i, true));
      await cooperate();
    }
    return value;
  };
  // Frames: parent, edge ordinal, key vector, count, next, array, forward link.
  const path = async (frame: number, edge?: string | number) => {
    let suffix = edge === undefined ? "" : typeof edge === "number" ? `[${edge}]` : `.${edge}`;
    while (frame) {
      const [parent, ordinal] = await get(frame, 2);
      if (!parent) break;
      const fields = await get(parent, 6);
      suffix = (fields[5] ? `[${ordinal}]` : `.${await keyAt(fields[2]! + ordinal! * 16)}`) + suffix;
      frame = parent;
    }
    return `$.metadata${suffix}`;
  };
  const fail = async (frame: number, edge?: string | number, message = "Invalid shape"): Promise<never> => {
    const location = await path(frame, edge);
    throw new PandocError("E_AST", "convert", `${location}: ${message}`, undefined, location);
  };
  const string = async (value: string, frame: number, edge?: string | number) => {
    for (let i = 0; i < value.length; i++) {
      if (i % 4096 === 0) await cooperate();
      const code = value.charCodeAt(i);
      if (code >= 0xd800 && code <= 0xdbff) {
        const next = value.charCodeAt(++i); if (!(next >= 0xdc00 && next <= 0xdfff)) await fail(frame, edge, "Invalid Unicode");
      } else if (code >= 0xdc00 && code <= 0xdfff) await fail(frame, edge, "Invalid Unicode");
    }
  };
  const enter = async (value: object, parent: number, edge: number): Promise<number> => {
    const array = Array.isArray(value), frame = scratch.allocate(56);
    await put(frame, [parent, edge, 0, 0, 0, array ? 1 : 0, 0]);
    if (Object.getOwnPropertySymbols(value).length) await fail(frame);
    if (!array && Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) await fail(frame);
    const names = array ? [] : Object.getOwnPropertyNames(value);
    const count = array ? value.length : names.length;
    if (array && Object.keys(value).length !== count) await fail(frame);
    const keys = array ? 0 : scratch.allocate(count * 16);
    for (let i = 0; i < count; i++) {
      await cooperate();
      const key = array ? i : names[i]!;
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !("value" in descriptor)) await fail(frame, key, array ? "Accessor or sparse array" : "Invalid shape");
      if (!array && (!descriptor!.enumerable || ["__proto__", "constructor", "prototype"].includes(key as string))) await fail(frame, key);
      if (!array) {
        await string(key as string, frame);
        const name = key as string, start = scratch.allocate(name.length * 2);
        for (let offset = 0; offset < name.length; offset += 4096) {
          const bytes = new Uint8Array(Math.min(4096, name.length - offset) * 2), view = new DataView(bytes.buffer);
          for (let j = 0; j < bytes.length / 2; j++) view.setUint16(j * 2, name.charCodeAt(offset + j), true);
          await scratch.write(start + offset * 2, bytes); await cooperate();
        }
        await put(keys + i * 16, [start, name.length]);
      }
    }
    await put(frame + 16, [keys, count]); await tree.begin(array ? "array" : "object"); return frame;
  };
  const resolve = async (frame: number, candidate?: object, edge?: string | number): Promise<object> => {
    let value: object = root, child = 0;
    if (value === candidate) await fail(frame, edge, "Non-JSON or cyclic input");
    for (let cursor = frame; cursor;) {await put(cursor + 48, [child]); child = cursor; cursor = (await get(cursor, 1))[0]!; await cooperate();}
    while (child !== frame) {
      const fields = await get(child, 7), next = fields[6]!, edge = (await get(next, 2))[1]!;
      const key = fields[5] ? edge : await keyAt(fields[2]! + edge * 16);
      value = Object.getOwnPropertyDescriptor(value, key)!.value as object;
      if (value === candidate) await fail(frame, edge, "Non-JSON or cyclic input");
      child = next; await cooperate();
    }
    return value;
  };
  try {
    let frame = await enter(root, 0, 0), current: object = root;
    while (frame) {
      await cooperate();
      const [parent, , keys, count, index, array] = await get(frame, 6);
      if (index! >= count!) {await tree.end(); frame = parent!; if (frame) current = await resolve(frame); continue;}
      await put(frame + 32, [index! + 1]);
      const key = array ? index! : await keyAt(keys! + index! * 16);
      const descriptor = Object.getOwnPropertyDescriptor(current, key);
      if (!descriptor || !("value" in descriptor)) await fail(frame, key);
      const value: unknown = descriptor!.value;
      if (!array) await tree.key(key as string);
      if (value === null || typeof value === "boolean" || typeof value === "number" && Number.isFinite(value)) await tree.value(value);
      else if (typeof value === "string") {await string(value, frame, key); await tree.value(value);}
      else if (typeof value === "object" && value) {
        await resolve(frame, value, key); frame = await enter(value, frame, index!); current = value;
      } else await fail(frame, key, typeof value === "number" ? "Invalid shape" : "Non-JSON or cyclic input");
    }
    const enums = new IntegerTable(scratch, 64);
    await validateBackedPandoc(tree, scratch, context, async node => {await enums.set(BigInt(node), 1n);});
    // Walk parent links; the destination tape holds its own construction stack.
    let node = tree.rootPosition;
    while (node) {
      await cooperate();
      const header = await tree.describe(node);
      if (await enums.get(BigInt(node))) {
        await result.begin("object"); await result.key("t"); await result.begin("string");
        for await (const part of tree.scalarChunks(node)) await result.text(part);
        await result.end(); await result.end();
      } else {
        await result.begin(header.kind);
        if ((header.kind === "array" || header.kind === "object") && header.children) {node += 32; continue;}
        if (header.kind !== "array" && header.kind !== "object") for await (const part of tree.scalarChunks(node)) await result.text(part);
        await result.end();
      }
      let completed = node;
      while (true) {
        const child = await tree.describe(completed);
        if (!child.parent) {node = 0; break;}
        const parent = await tree.describe(child.parent);
        if (child.end < parent.end) {node = child.end; break;}
        await result.end(); completed = child.parent;
      }
    }
    return {tree: result, close};
  } catch (error) {try {await close();} catch { /* Preserve admission error. */ } throw error;}
}
