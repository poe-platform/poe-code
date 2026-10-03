import {IntegerTable, type PagedStorage} from "safe-bash-io-engine/storage";
import type {BackedJson} from "./backed-json.js";
import type {LuaStorage, LuaReference, StoredLuaValue} from "./lua-storage.js";
import {readJsonNumber, JsonNumberError} from "./json-number.js";
import {PandocError} from "./errors.js";

function fail(message: string): never {throw new PandocError("E_AST", "convert", message);}

/** Transfer JSON values across the retained Lua heap boundary. These operations
 * do not invoke the interpreter or translate Pandoc constructors. Imported empty
 * object/array identities are retained; new empty Lua tables default to arrays,
 * as in the existing Lua replacement reader. Traversal and cycle state are backed. */
export class LuaJsonBridge {
  private readonly objects: IntegerTable;
  private marker: Promise<LuaReference> | undefined;
  constructor(private readonly heap: LuaStorage, private readonly scratch: PagedStorage, private readonly cooperate: (units?: number) => Promise<void>) {
    this.objects = new IntegerTable(scratch, 64);
  }
  private nullKey(): Promise<LuaReference> {
    return this.marker ??= this.heap.string([new TextEncoder().encode("__pandoc_null")]);
  }
  private async *utf8(tree: BackedJson, position: number): AsyncGenerator<Uint8Array> {
    const encoder = new TextEncoder();
    let pending = "";
    for await (const fragment of tree.scalarChunks(position)) {
      const text = pending + fragment;
      const last = text.charCodeAt(text.length - 1);
      const end = last >= 0xd800 && last <= 0xdbff ? text.length - 1 : text.length;
      pending = text.slice(end);
      for (let i = 0; i < end; i++) {
        const code = text.charCodeAt(i);
        if (code >= 0xd800 && code <= 0xdbff) {
          const next = text.charCodeAt(++i);
          if (next < 0xdc00 || next > 0xdfff || i >= end) fail("Invalid Unicode");
        } else if (code >= 0xdc00 && code <= 0xdfff) fail("Invalid Unicode");
      }
      if (end) yield encoder.encode(text.slice(0, end));
    }
    if (pending) fail("Invalid Unicode");
  }
  private async pushFrame(parent: number, id: number, array: boolean, cursor: number, end: number): Promise<number> {
    const bytes = new Uint8Array(40), view = new DataView(bytes.buffer);
    [parent, id, Number(array), cursor, end].forEach((value, i) => view.setFloat64(i * 8, value, true));
    return this.scratch.append(bytes);
  }
  private async frame(position: number) {
    const bytes = await this.scratch.read(position, 40), view = new DataView(bytes.buffer, bytes.byteOffset, bytes.length);
    return {parent: view.getFloat64(0, true), id: view.getFloat64(8, true), array: Boolean(view.getFloat64(16, true)), cursor: view.getFloat64(24, true), end: view.getFloat64(32, true)};
  }
  private async cursor(position: number, value: number): Promise<void> {
    const bytes = new Uint8Array(8);
    new DataView(bytes.buffer).setFloat64(0, value, true);
    await this.scratch.write(position + 24, bytes);
  }
  async read(tree: BackedJson): Promise<StoredLuaValue> {
    const end = (await tree.describe(tree.rootPosition)).end;
    if (!end) fail("Incomplete JSON tree");
    const marker = await this.nullKey();
    let root: StoredLuaValue, frame = 0;
    for (let position = tree.rootPosition; position < end;) {
      await this.cooperate();
      let parent = frame ? await this.frame(frame) : undefined;
      while (parent && position >= parent.end) {
        frame = parent.parent;
        parent = frame ? await this.frame(frame) : undefined;
        await this.cooperate();
      }
      const header = await tree.describe(position);
      let value: StoredLuaValue;
      if (header.kind === "key" || header.kind === "string") {
        value = await this.heap.string(this.utf8(tree, position));
        if (header.kind === "key") {
          await this.cursor(frame, value.id);
          position = header.end;
          continue;
        }
      } else if (header.kind === "array" || header.kind === "object") {
        value = await this.heap.table();
        if (header.kind === "object") await this.objects.set(BigInt(value.id), 1n);
      } else {
        const literal = await tree.smallText(position, 5);
        if (literal === "true" || literal === "false") value = literal === "true";
        else if (literal === "null") {
          value = await this.heap.table();
          await this.heap.set(value, marker, true);
        } else {
          try {value = await readJsonNumber(tree.scalarChunks(position), units => this.cooperate(units));}
          catch (error) {if (error instanceof JsonNumberError) fail(error.message); throw error;}
        }
      }
      if (!parent) root = value;
      else {
        const target: LuaReference = {kind: "table", id: parent.id};
        if (parent.array) {
          await this.cursor(frame, parent.cursor + 1);
          await this.heap.set(target, parent.cursor + 1, value);
        } else await this.heap.set(target, {kind: "string", id: parent.cursor}, value);
      }
      if (header.kind === "array" || header.kind === "object") {
        frame = await this.pushFrame(frame, (value as LuaReference).id, header.kind === "array", 0, header.end);
        position += 32;
      } else position = header.end;
    }
    return root;
  }
  private async text(value: LuaReference, output: BackedJson): Promise<void> {
    const decoder = new TextDecoder("utf-8", {fatal: true});
    for await (const bytes of this.heap.bytes(value)) {
      let text: string;
      try {text = decoder.decode(bytes, {stream: true});}
      catch {return fail("Invalid UTF-8 Lua string");}
      await output.text(text);
    }
    let tail: string;
    try {tail = decoder.decode();}
    catch {return fail("Invalid UTF-8 Lua string");}
    if (tail) await output.text(tail);
  }
  async write(value: StoredLuaValue, output: BackedJson): Promise<void> {
    const active = new IntegerTable(this.scratch, 64), marker = await this.nullKey();
    let frame = 0;
    const append = async (value: StoredLuaValue): Promise<void> => {
      await this.cooperate();
      if (value === undefined) fail("Invalid nil Lua replacement value");
      if (typeof value !== "object") {
        if (typeof value === "number" && !Number.isFinite(value)) fail("Non-finite Lua number");
        await output.begin("literal"); await output.text(JSON.stringify(value)); await output.end();
        return;
      }
      if (value.kind === "string") {
        await output.begin("string"); await this.text(value, output); await output.end();
        return;
      }
      if (value.kind === "function") fail("Invalid Lua replacement value");
      const nullMarker = await this.heap.get(value, marker);
      if (nullMarker !== undefined && nullMarker !== false) {
        await output.begin("literal"); await output.text("null"); await output.end();
        return;
      }
      if (await active.get(BigInt(value.id)) === 1n) fail("Cyclic Lua replacement value");
      let array: boolean | undefined, count = 0, maximum = 0;
      for (let entry = await this.heap.next(value); entry; entry = await this.heap.next(value, entry.key)) {
        const numeric = typeof entry.key === "number";
        if (!numeric && (typeof entry.key !== "object" || entry.key.kind !== "string")) fail("Invalid Lua table key");
        if (array !== undefined && array !== numeric) fail("Mixed Lua table keys");
        array = numeric;
        count++;
        if (numeric) {
          const index = entry.key as number;
          if (!Number.isSafeInteger(index) || index < 1) fail("Lua lists require consecutive integer keys");
          maximum = Math.max(maximum, index);
        }
      }
      array ??= await this.objects.get(BigInt(value.id)) !== 1n;
      if (array && maximum !== count) fail("Lua lists require consecutive integer keys");
      await active.set(BigInt(value.id), 1n);
      await output.begin(array ? "array" : "object");
      frame = await this.pushFrame(frame, value.id, array, array ? 1 : 0, count);
    };
    await append(value);
    while (frame) {
      await this.cooperate();
      const current = await this.frame(frame);
      const source: LuaReference = {kind: "table", id: current.id};
      if (current.array) {
        if (current.cursor <= current.end) {
          await this.cursor(frame, current.cursor + 1);
          await append(await this.heap.get(source, current.cursor));
          continue;
        }
      } else {
        const entry = await this.heap.next(source, current.cursor ? {kind: "string", id: current.cursor} : undefined);
        if (entry) {
          const key = entry.key as LuaReference;
          await this.cursor(frame, key.id);
          await output.begin("key"); await this.text(key, output); await output.end();
          await append(entry.value);
          continue;
        }
      }
      await output.end();
      await active.set(BigInt(source.id), 0n);
      frame = current.parent;
    }
  }
}
