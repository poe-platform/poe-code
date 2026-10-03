import {PandocError} from "./errors.js";
import type {LuaReference, LuaStorage, StoredLuaValue} from "./lua-storage.js";

type Method = "__pairs" | "__tostring" | "__name" | "__index" | "__newindex" | "__call" | "__len" | "__eq" | "__lt" | "__le" | "__concat"
  | "__add" | "__sub" | "__mul" | "__mod" | "__pow" | "__div" | "__idiv" | "__band" | "__bor" | "__bxor" | "__shl" | "__shr" | "__unm" | "__bnot";
export interface LuaCall {callee: StoredLuaValue; args: Iterable<StoredLuaValue> | AsyncIterable<StoredLuaValue>}
export type LuaAccess = {value: StoredLuaValue} | {call: LuaCall};
const isTable = (value: StoredLuaValue): value is LuaReference => typeof value === "object" && value.kind === "table";
const isFunction = (value: StoredLuaValue): value is LuaReference => typeof value === "object" && value.kind === "function";

/** Metamethod lookup keeps only a fixed set of name references in memory.
 * Function calls are returned to the interpreter for backed continuations. */
export class LuaMetatables {
  private readonly keys = new Map<Method, Promise<LuaReference>>();
  constructor(private readonly heap: LuaStorage) {}
  async method(value: StoredLuaValue, name: Method): Promise<StoredLuaValue> {
    if (!isTable(value)) return undefined;
    const metatable = await this.heap.metatable(value);
    if (!metatable) return undefined;
    let key = this.keys.get(name);
    if (!key) {key = this.heap.string([new TextEncoder().encode(name)]); this.keys.set(name, key);}
    return this.heap.get(metatable, await key);
  }
  async binary(left: StoredLuaValue, right: StoredLuaValue, name: Method): Promise<LuaCall | undefined> {
    let callee = await this.method(left, name);
    if (callee === undefined) callee = await this.method(right, name);
    return callee === undefined ? undefined : {callee, args: [left, right]};
  }
  async index(value: StoredLuaValue, key: StoredLuaValue): Promise<LuaAccess> {
    for (let chain = 0; chain < 2000; chain++) {
      if (isTable(value)) {
        const found = await this.heap.get(value, key);
        if (found !== undefined) return {value: found};
      }
      const method = await this.method(value, "__index");
      if (method === undefined) {
        if (isTable(value)) return {value: undefined};
        throw new PandocError("E_AST", "convert", "Expected Lua table for indexing");
      }
      if (isFunction(method)) return {call: {callee: method, args: [value, key]}};
      value = method;
    }
    throw new PandocError("E_AST", "convert", "'__index' chain too long; possible loop");
  }
  async assign(value: StoredLuaValue, key: StoredLuaValue, assigned: StoredLuaValue): Promise<LuaCall | undefined> {
    for (let chain = 0; chain < 2000; chain++) {
      const method = await this.method(value, "__newindex");
      if (isTable(value) && (await this.heap.get(value, key) !== undefined || method === undefined)) {
        await this.heap.set(value, key, assigned); return undefined;
      }
      if (method === undefined) throw new PandocError("E_AST", "convert", "Expected Lua table for assignment");
      if (isFunction(method)) return {callee: method, args: [value, key, assigned]};
      value = method;
    }
    throw new PandocError("E_AST", "convert", "'__newindex' chain too long; possible loop");
  }
  async callable(call: LuaCall): Promise<{callee: LuaReference; args: LuaCall["args"]}> {
    if (isFunction(call.callee)) return {callee: call.callee, args: call.args};
    const method = await this.method(call.callee, "__call");
    if (!isFunction(method)) throw new PandocError("E_AST", "convert", "Expected Lua function");
    return {callee: method, args: (async function* () {yield call.callee; yield* call.args;})()};
  }
}
