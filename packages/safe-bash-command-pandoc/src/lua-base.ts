import {PandocError} from "./errors.js";
import {integral,integer,isInteger} from "./lua-arithmetic.js";
import {LuaNumbers} from "./lua-numbers.js";
import {LuaStrings} from "./lua-strings.js";
import {LuaMetatables} from "./lua-metatables.js";
import {LuaError} from "./lua-error.js";
import type {LuaArguments,LuaNativeContext,LuaNativeOutput} from "./lua-machine.js";
import type {LuaReference, LuaStorage, StoredLuaValue} from "./lua-storage.js";

const minimumArguments = {setmetatable: 2, getmetatable: 1, rawget: 2, rawset: 3, rawequal: 2, rawlen: 1, type: 1, next: 1, tostring:1, pairs:1, ipairs:1, select:1, assert:1, error:0, tonumber:1} as const;
type Name=keyof typeof minimumArguments;
const ipairsIterator=-99;
const names = Object.keys(minimumArguments) as (keyof typeof minimumArguments)[];
function table(value: StoredLuaValue): LuaReference {
  if (typeof value !== "object" || value.kind !== "table") throw new PandocError("E_AST", "convert", "Expected Lua table");
  return value;
}

/** Fixed native base-library operations over caller-backed values. Function IDs
 * are negative and stable; no native registry grows with Lua input. */
export class LuaBase {
  private protectedKey: Promise<LuaReference> | undefined;
  private readonly functions=new Map<number,Promise<LuaReference>>();
  private readonly numbers: LuaNumbers;
  private readonly strings: LuaStrings;
  private readonly metatables: LuaMetatables;
  constructor(private readonly heap: LuaStorage) {
    this.numbers=new LuaNumbers(heap); this.strings=new LuaStrings(heap); this.metatables=new LuaMetatables(heap);
  }
  private closure(prototype:number):Promise<LuaReference> {
    let closure=this.functions.get(prototype);
    if(!closure) {closure=this.heap.closure(prototype,[]); this.functions.set(prototype,closure);}
    return closure;
  }
  async install(environment: LuaReference): Promise<void> {
    for (let i = 0; i < names.length; i++) {
      const key = await this.heap.string([new TextEncoder().encode(names[i]!)]);
      await this.heap.set(environment, key, await this.closure(-i - 1));
    }
    await this.heap.set(environment,await this.heap.string([new TextEncoder().encode("_G")]),environment);
    await this.heap.set(environment,await this.heap.string([new TextEncoder().encode("_VERSION")]),await this.heap.string([new TextEncoder().encode("Lua 5.3")]));
  }
  async invoke(prototype: number,args: LuaArguments,context: LuaNativeContext):Promise<LuaNativeOutput> {
    if(prototype===ipairsIterator) {
      if(args.count<2) throw new PandocError("E_AST","convert","Value expected");
      if(context.continuation===1) {
        const value=context.results.count?await context.results.get(0):undefined;
        return value===undefined?[undefined]:[await this.heap.get(context.state,0),value];
      }
      const index=integer(integral(await this.numbers.coerce(await args.get(1)))+1);
      const value=await this.metatables.index(await args.get(0),index);
      if("call" in value) {await this.heap.set(context.state,0,index); return {call:value.call,continuation:1};}
      return value.value===undefined?[undefined]:[index,value.value];
    }
    const name = names[-prototype - 1];
    if (!name) throw new PandocError("E_UNSUPPORTED_FEATURE", "convert", `Unknown native Lua function ${prototype}`);
    if (args.count < minimumArguments[name]) throw new PandocError("E_AST", "convert", "Value expected");
    const value=await args.get(0);
    if(name==="pairs") {
      if(context.continuation===1) return this.range(context.results,0,3);
      const method=await this.metatables.method(value,"__pairs");
      return method!==undefined?{call:{callee:method,args:[value]},continuation:1}:[await this.closure(-names.indexOf("next")-1),value,undefined];
    }
    if(name==="ipairs") return [await this.closure(ipairsIterator),value,integer(0)];
    if(name==="tostring") {
      if(context.continuation===1) {
        const result=context.results.count?await context.results.get(0):undefined;
        if(typeof result!=="number" && !(typeof result==="object" && (result.kind==="integer" || result.kind==="string")))
          throw new PandocError("E_AST","convert","'__tostring' must return a string");
        return [await this.text(result)];
      }
      const method=await this.metatables.method(value,"__tostring");
      return method!==undefined?{call:{callee:method,args:[value]},continuation:1}:[await this.text(value)];
    }
    if(name==="assert") {
      if(value!==undefined && value!==false) return this.range(args,0,args.count);
      throw new LuaError(args.count>1?await args.get(1):await this.heap.string([new TextEncoder().encode("assertion failed!")]),1);
    }
    if(name==="error") {
      const level=await args.get(1);
      throw new LuaError(value,level===undefined?1:integral(await this.numbers.coerce(level)));
    }
    if(name==="select") {
      if(typeof value==="object" && value.kind==="string") for await(const bytes of this.heap.bytes(value)) {
        if(bytes[0]===35) return [integer(args.count-1)];
        break;
      }
      let index=integral(await this.numbers.coerce(value));
      if(index<0) index+=args.count; else index=Math.min(index,args.count);
      if(index<1) throw new PandocError("E_AST","convert","index out of range");
      return this.range(args,index,args.count);
    }
    if(name==="tonumber") {
      const base=await args.get(1);
      if(base!==undefined) {
        const radix=integral(await this.numbers.coerce(base));
        if(typeof value!=="object" || value.kind!=="string") throw new PandocError("E_AST","convert","Expected Lua string");
        if(radix<2 || radix>36) throw new PandocError("E_AST","convert","base out of range");
        return [await this.radix(value,radix)];
      }
      if(typeof value==="number" || isInteger(value)) return [value];
      if(typeof value!=="object" || value.kind!=="string") return [undefined];
      try {return [await this.numbers.parse(value)];}
      catch(error) {if(error instanceof PandocError && error.code==="E_AST") return [undefined]; throw error;}
    }
    return this.simple(name,args,value);
  }
  private async *range(args:LuaArguments,start:number,end:number):AsyncGenerator<StoredLuaValue> {
    for(let i=start;i<end;i++) yield i<args.count?await args.get(i):undefined;
  }
  private async text(value:StoredLuaValue):Promise<LuaReference> {
    if(typeof value==="object" && value.kind==="string") return value;
    if(typeof value==="number" || isInteger(value)) return this.strings.concat((async function*(){yield value;})());
    if(typeof value==="object") {
      const custom=await this.metatables.method(value,"__name");
      const name=typeof custom==="object" && custom.kind==="string"?custom:await this.heap.string([new TextEncoder().encode(value.kind)]);
      const suffix=await this.heap.string([new TextEncoder().encode(`: 0x${value.id.toString(16)}`)]);
      return this.strings.concat((async function*(){yield name; yield suffix;})());
    }
    return this.heap.string([new TextEncoder().encode(value===undefined?"nil":String(value))]);
  }
  private async radix(value:LuaReference,base:number):Promise<StoredLuaValue> {
    // Fengari strips leading zeros, validates the entire ASCII token, then uses
    // parseInt (including its partial-digit and binary64-rounding behavior).
    // 1100 non-leading digits exceed binary64's range even in radix two; a
    // bounded prefix therefore preserves parseInt's final signed-32-bit result.
    let phase=0,negative=false,seen=false,prefix="";
    for await(const bytes of this.heap.bytes(value)) for(const byte of bytes) {
      const space=byte===32 || byte>=9 && byte<=13;
      if(phase===0) {if(space) continue; phase=1; if(byte===43 || byte===45) {negative=byte===45; continue;}}
      if(phase===3) {if(!space) return undefined; continue;}
      if(space) {if(!seen) return undefined; phase=3; continue;}
      if(!(byte>=48 && byte<=57 || byte>=65 && byte<=90 || byte>=97 && byte<=122)) return undefined;
      seen=true;
      if(phase===1 && byte===48) continue;
      phase=2; if(prefix.length<1100) prefix+=String.fromCharCode(byte);
    }
    if(!seen) return undefined;
    const number=Number.parseInt((negative?"-":"")+(prefix || "0"),base);
    return Number.isNaN(number)?undefined:integer(number);
  }
  private async *simple(name:Name,args:LuaArguments,value:StoredLuaValue):AsyncGenerator<StoredLuaValue> {
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
