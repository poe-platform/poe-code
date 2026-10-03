import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import runtime from "./fengari.generated.js";
import {ExecutionContext} from "./execution.js";
import {LuaStorage, type StoredLuaValue} from "./lua-storage.js";
import {LuaProgram} from "./lua-program.js";
import {LuaFrames} from "./lua-frames.js";
import {LuaMachine} from "./lua-machine.js";

interface CompiledPrototype {
  numparams: number; is_vararg: boolean; maxstacksize: number;
  code: {code: number}[]; lineinfo: number[];
  k: {type: number; value: unknown}[];
  p: CompiledPrototype[]; upvalues: {instack: number; idx: number}[];
}
const integer = (value: number): StoredLuaValue => ({kind: "integer", value});

// The existing compiler provides authentic Lua 5.3 instruction sequences for
// these small fixtures. Its resident output is not the production compiler for
// the retained runtime; production compilation still needs bounded storage.
async function execute(source: string, args: StoredLuaValue[] = [], signal?: AbortSignal): Promise<(StoredLuaValue | string)[]> {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", signal ? {signal} : {});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: signal ?? new AbortController().signal}, 1);
  const cooperate = (units?: number) => context.cooperate(units);
  const heap = new LuaStorage(storage, cooperate), program = new LuaProgram(storage, heap, cooperate);
  const frames = new LuaFrames(storage, heap, cooperate), machine = new LuaMachine(program, frames, heap, cooperate);
  const compiler = runtime as typeof import("fengari"), state = compiler.lauxlib.luaL_newstate();
  try {
    const bytes = new TextEncoder().encode(source);
    expect(compiler.lauxlib.luaL_loadbuffer(state, bytes, bytes.length, new TextEncoder().encode("fixture"))).toBe(compiler.lua.LUA_OK);
    const internal = state as unknown as {top: number; stack: {value: {p: CompiledPrototype}}[]};
    const retain = async (compiled: CompiledPrototype): Promise<number> => {
      const prototype = await program.create({parameters: compiled.numparams, vararg: compiled.is_vararg, registers: compiled.maxstacksize});
      for (let i = 0; i < compiled.code.length; i++) await program.emit(prototype, compiled.code[i]!.code, compiled.lineinfo[i]!);
      for (const value of compiled.k) {
        let stored: StoredLuaValue;
        if (value.type === 0) stored = undefined;
        else if (value.type === 1) stored = Boolean(value.value);
        else if (value.type === 3) stored = value.value as number;
        else if (value.type === 19) stored = integer(value.value as number);
        else if (value.type === 4 || value.type === 20) stored = await heap.string([(value.value as {getstr(): Uint8Array}).getstr()]);
        else throw new Error(`Unexpected fixture constant ${value.type}`);
        await program.addConstant(prototype, stored);
      }
      for (const child of compiled.p) await program.addChild(prototype, await retain(child));
      for (const capture of compiled.upvalues) await program.addCapture(prototype, {register: Boolean(capture.instack), index: capture.idx});
      return prototype;
    };
    const prototype = await retain(internal.stack[internal.top - 1]!.value.p);
    const closure = await heap.closure(prototype, [await heap.cell(await heap.table())]);
    const result = await machine.run(closure, args), values: (StoredLuaValue | string)[] = [];
    for (let i = 0; i < result.count; i++) {
      const value = await heap.get(result.values, i);
      if (typeof value === "object" && value.kind === "string") {
        const decoder = new TextDecoder();
        let text = "";
        for await (const bytes of heap.bytes(value)) text += decoder.decode(bytes, {stream: true});
        values.push(text + decoder.decode());
      } else values.push(value);
    }
    if (!signal && args.length === 0) {
      expect(compiler.lua.lua_pcall(state, 0, -1, 0)).toBe(compiler.lua.LUA_OK);
      const native = state as unknown as {top: number; stack: {type: number; value: unknown}[]};
      const expected = native.stack.slice(1, native.top).map(value => {
        if (value.type === 0) return undefined;
        if (value.type === 19) return integer(value.value as number);
        if (value.type === 4 || value.type === 20) return new TextDecoder().decode((value.value as {getstr(): Uint8Array}).getstr());
        return value.value;
      });
      expect(values).toEqual(expected);
    }
    return values;
  } finally {
    compiler.lua.lua_close(state);
    await storage.close(); await context.close();
    expect(await fs.readdir("/")).toEqual([]);
  }
}

it("executes compiled arithmetic with Lua integer tags and overflow", async () => {
  expect(await execute(`local a,b=...; return a+b,a-b,a*b,a//b,a%b,a/b,a^b,a&b,a|b,a~b,a<<b,a>>b,-a,~a,not a`, [integer(7), integer(2)]))
    .toEqual([integer(9), integer(5), integer(14), integer(3), integer(1), 3.5, 49, integer(2), integer(7), integer(5), integer(28), integer(1), integer(-7), integer(-8), false]);
  expect(await execute("local a,b=...; return a+b,a*b", [integer(2147483647), integer(2)]))
    .toEqual([integer(-2147483647), integer(-2)]);
});

it("executes nested calls and numeric loops through retained registers", async () => {
  expect(await execute(`local function add(a,b) return a+b end
    local total=0; for i=1,10 do total=add(total,i) end; return total,3/2`))
    .toEqual([integer(55), 1.5]);
});

it("keeps loop-local captured cells alive after closing and reusing their registers", async () => {
  expect(await execute(`local out={}; for i=1,3 do local n=i
    out[i]=function(delta) n=n+delta; return n end end
    return out[1](10),out[1](1),out[2](0),out[3](0)`))
    .toEqual([integer(11), integer(12), integer(2), integer(3)]);
});

it("preserves open varargs and nil slots through tail calls", async () => {
  expect(await execute(`local function loop(n,...) if n==0 then return ... end
    return loop(n-1,...) end; return loop(30,7,nil,false,9)`))
    .toEqual([integer(7), undefined, false, integer(9)]);
});

it("retains non-tail return continuations and global upvalues", async () => {
  expect(await execute(`total=0; local function sum(n) if n==0 then return 0 end
    total=total+1; return n+sum(n-1) end; local result=sum(20); return result,total`))
    .toEqual([integer(210), integer(20)]);
});

it("runs generic for iterators with multiple results and table constructors", async () => {
  expect(await execute(`local function iter(t,i) i=i+1; if i<=3 then return i,t[i] end end
    local total=0; for i,v in iter,{1,2,3},0 do total=total+v end; return total`))
    .toEqual([integer(6)]);
});

it("executes concatenation, string lengths, branches and existing string collation", async () => {
  expect(await execute(`local n=...; local s="x"..n..(n/2).."✓"
    local v=false or 4; local w=v and 5
    local x="\\1".."\\35"; local y="\\18".."\\3"
    return s,#s,w,"alpha"<"beta","a"<="a",x<=y,x==y`, [integer(6)]))
    .toEqual(["x63.0✓", integer(8), integer(5), true, true, true, false]);
});

it("preserves method receivers, closure caching and table lengths", async () => {
  expect(await execute(`local t={1,2,3}; function t:add(n) return #self+n end
    local function factory() return function() return 7 end end
    return t:add(4),factory()==factory()`)).toEqual([integer(7),true]);
});

it("matches integer and floating loop bounds in both directions", async () => {
  expect(await execute(`local a,b,c=0,0,0
    for i=1,3.9 do a=a+i end
    for i=3,0.1,-1 do b=b+i end
    for i=0.5,2,0.5 do c=c+i end
    return a,b,c`)).toEqual([integer(6),integer(6),5]);
});

it.each([
  ["local a,b=...; return a//b", [integer(1),integer(0)], "divide by zero"],
  ["local a,b=...; return a%b", [integer(1),integer(0)], "n%0"],
  ["local a=...; return a&1", [1.5], "integer representation"]
])("cleans backing storage after arithmetic errors: %s", async (source,args,message) => {
  await expect(execute(source,args as StoredLuaValue[])).rejects.toThrow(message);
});

it("interrupts actual retained execution and cleans all backing files", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new Error("retained loop cancelled")), 20);
  try {
    await expect(execute("while true do end", [], controller.signal)).rejects.toMatchObject({code: "E_CANCELLED"});
  } finally {clearTimeout(timer);}
});

it("concatenates and compares strings across backing chunk boundaries", async () => {
  expect(await execute(`local a="x"; for i=1,14 do a=a..a end
    local b=a.."a"; local c=a.."b"; return #a,#b,b<c,c<=b,a==a`))
    .toEqual([integer(16384),integer(16385),true,false,true]);
});


it("coerces decimal and hexadecimal strings for arithmetic and numeric loops", async () => {
  expect(await execute(`local a,b,c=" 12 ","0x10","0x1.8p2"
    local sum=0; for i="1","3","1" do sum=sum+i end
    return a+b,c+1,-a,a&3,sum,"2"+0.5`))
    .toEqual([28,7,-12,integer(0),6,2.5]);
});


it.each([".5", "1.", "+12", "-0", "-0.0", "2147483648", "-2147483648", "1e309", "1e-324",
  "0xFFFFFFFF", "-0xFFFFFFFF", "0x100000001", "0x.8", "0x1p-1074", "0x1.fffffffffffffp1023",
  "0x123456789abcdef123456789abcdef123456789.abc", "  2.5e+2  "])("matches native numeric coercion for %s", async value => {
  await execute(`local n=${JSON.stringify(value)}; return n+0`);
});

it.each(["", " ", "+", ".", "0x", "0x.", "1e", "1e+", "1 2", "1e 2", "--1", "nan", "inf", "1.2.3"])
("rejects malformed numeric string %s", async value => {
  await expect(execute(`local n=${JSON.stringify(value)}; return n+0`)).rejects.toThrow("Expected Lua number");
});

it("coerces long numeric strings without a payload-sized numeric buffer", async () => {
  await execute(`local zero="0"; for i=1,14 do zero=zero..zero end
    local a=zero.."1.5"; local b="0x"..zero.."FFFFFFFF"; local c="1."..zero.."1"
    return a+0,b+0,c+0`);
});
