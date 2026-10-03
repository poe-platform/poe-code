import {PandocError} from "./errors.js";
import type {LuaArguments} from "./lua-machine.js";
import type {LuaReference, LuaStorage, StoredLuaValue} from "./lua-storage.js";

const minimumArguments = {setmetatable: 2, getmetatable: 1, rawget: 2, rawset: 3, rawequal: 2, rawlen: 1, type: 1, next: 1} as const;
const names = Object.keys(minimumArguments) as (keyof typeof minimumArguments)[];
function table(value: StoredLuaValue): LuaReference {
  if (typeof value !== "object" || value.kind !== "table") throw new PandocError("E_AST", "convert", "Expected Lua table");
  return value;
}

/** Fixed native base-library operations over caller-backed values. Function IDs
 * are negative and stable; no native registry grows with Lua input. */
export class LuaBase {
  private protectedKey: Promise<LuaReference> | undefined;
  constructor(private readonly heap: LuaStorage) {}
  async install(environment: LuaReference): Promise<void> {
    for (let i = 0; i < names.length; i++) {
      const key = await this.heap.string([new TextEncoder().encode(names[i]!)]);
      await this.heap.set(environment, key, await this.heap.closure(-i - 1, []));
    }
  }
  async *invoke(prototype: number, args: LuaArguments): AsyncGenerator<StoredLuaValue> {
    const name = names[-prototype - 1];
    if (!name) throw new PandocError("E_UNSUPPORTED_FEATURE", "convert", `Unknown native Lua function ${prototype}`);
    if (args.count < minimumArguments[name]) throw new PandocError("E_AST", "convert", "Value expected");
    const value = await args.get(0);
    switch (name) {
      case "setmetatable": {
        const target = table(value), next = await args.get(1), previous = await this.heap.metatable(target);
        if (next !== undefined) table(next);
        if (previous && await this.heap.get(previous, await (this.protectedKey ??= this.heap.string([new TextEncoder().encode("__metatable")]))) !== undefined)
          throw new PandocError("E_AST", "convert", "Cannot change a protected metatable");
        await this.heap.setMetatable(target, next as LuaReference | undefined);
        yield target; break;
      }
      case "getmetatable": {
        const metatable = typeof value === "object" && value.kind === "table" ? await this.heap.metatable(value) : undefined;
        if (!metatable) yield undefined;
        else {
          const protectedValue = await this.heap.get(metatable, await (this.protectedKey ??= this.heap.string([new TextEncoder().encode("__metatable")])));
          yield protectedValue === undefined ? metatable : protectedValue;
        }
        break;
      }
      case "rawget": yield await this.heap.get(table(value), await args.get(1)); break;
      case "rawset": await this.heap.set(table(value), await args.get(1), await args.get(2)); yield value; break;
      case "rawequal": yield await this.heap.equal(value, await args.get(1)); break;
      case "rawlen": {
        const length = typeof value === "object" && value.kind === "string" ? await this.heap.byteLength(value) : await this.heap.length(table(value));
        yield {kind: "integer", value: length | 0}; break;
      }
      case "type": {
        const type = value === undefined ? "nil" : typeof value === "object" ? value.kind === "integer" ? "number" : value.kind : typeof value;
        yield await this.heap.string([new TextEncoder().encode(type)]); break;
      }
      case "next": {
        const next = await this.heap.next(table(value), await args.get(1));
        if (next) {yield next.key; yield next.value;} else yield undefined;
        break;
      }
    }
  }
}
