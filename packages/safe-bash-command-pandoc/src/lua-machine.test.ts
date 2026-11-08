import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import runtime from "./fengari.generated.js";
import {ExecutionContext} from "./execution.js";
import {LuaStorage, type StoredLuaValue} from "./lua-storage.js";
import {LuaProgram} from "./lua-program.js";
import {LuaFrames} from "./lua-frames.js";
import {LuaBase} from "./lua-base.js";
import {LuaMachine, type LuaNative} from "./lua-machine.js";

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
async function execute(source: string, args: StoredLuaValue[] = [], signal?: AbortSignal, native: boolean | LuaNative = false): Promise<(StoredLuaValue | string)[]> {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", signal ? {signal} : {});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: signal ?? new AbortController().signal}, 1);
  const cooperate = (units?: number) => context.cooperate(units);
  const heap = new LuaStorage(storage, cooperate), program = new LuaProgram(storage, heap, cooperate);
  const frames = new LuaFrames(storage, heap, cooperate);
  const base = new LuaBase(heap);
  const machine = new LuaMachine(program, frames, heap, cooperate, (prototype, args, context) => {
    if (prototype === -1000 && native) {
      if (typeof native === "function") return native(prototype, args, context);
      return (async function* () {for (let i = 0; i < args.count; i++) yield await args.get(i);})();
    }
    return base.invoke(prototype, args, context);
  });
  const compiler = runtime as typeof import("fengari"), state = compiler.lauxlib.luaL_newstate();
  try {
    compiler.lauxlib.luaL_requiref(state, new TextEncoder().encode("_G"), compiler.lualib.luaopen_base, true);
    compiler.lua.lua_pop(state, 1);
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
    const environment = await heap.table();
    await base.install(environment);
    if (native) {
      await heap.set(environment, await heap.string([new TextEncoder().encode("identity")]), await heap.closure(-1000, []));
      compiler.lua.lua_pushjsfunction(state, state => compiler.lua.lua_gettop(state));
      compiler.lua.lua_setglobal(state, new TextEncoder().encode("identity"));
    }
    const closure = await heap.closure(prototype, [await heap.cell(environment)]);
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
  expect(await execute(`local a="x"; for i=1,13 do a=a..a end
    local b=a.."a"; local c=a.."b"; return #a,#b,b<c,c<=b,a==a`))
    .toEqual([integer(8192),integer(8193),true,false,true]);
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
  await execute(`local zero="0"; for i=1,13 do zero=zero..zero end
    local a=zero.."1.5"; local b="0x"..zero.."FFFFFFFF"; local c="1."..zero.."1"
    return a+0,b+0,c+0`);
});


it("streams native arguments and results through Lua calls and tail calls", async () => {
  expect(await execute(`local function tail(...) return identity(...) end
    local a,b,c=identity(1,nil,3); return a,b,c,tail(4,nil,false,7)`, [], undefined, true))
    .toEqual([integer(1),undefined,integer(3),integer(4),undefined,false,integer(7)]);
});


it("exposes raw table operations and protected metatables through native calls", async () => {
  expect(await execute(`local t={a=1}; local mt={__metatable="locked"}; setmetatable(t,mt)
    local x=rawset(t,"a",7); local k,v=next(t)
    return rawget(t,"a"),rawequal(t,x),getmetatable(t),k,v,type(t),type(nil),rawlen({1,2})`))
    .toEqual([integer(7),true,"locked","a",integer(7),"table","nil",integer(2)]);
});

it("rejects changes to protected metatables and cleans backing state", async () => {
  await expect(execute(`local t=setmetatable({}, {__metatable=false}); setmetatable(t,{})`))
    .rejects.toThrow("protected metatable");
});

it("resumes table metamethods through backed Lua frames", async () => {
  expect(await execute(`local target={a=2}; local proxy=setmetatable({}, {
    __index=function(t,k) return target[k]+1 end,
    __newindex=function(t,k,v) target[k]=v*2 end,
    __len=function(t) return 17 end,
    __call=function(t,a,b) return a+b,9 end})
    proxy.a=4; local a,b=proxy(3,5); return proxy.a,#proxy,a,b`))
    .toEqual([integer(9),integer(17),integer(8),integer(9)]);
});

it("follows table-valued index chains and bypasses them for existing entries", async () => {
  expect(await execute(`local target={x=3}; local middle=setmetatable({}, {__index=target,__newindex=target})
    local proxy=setmetatable({a=1}, {__index=middle,__newindex=middle}); proxy.a=7; proxy.x=9
    return proxy.a,proxy.x,rawget(proxy,"x"),target.x`))
    .toEqual([integer(7),integer(9),undefined,integer(9)]);
});

it("rejects cyclic table delegation with the existing chain limit", async () => {
  await expect(execute(`local a={}; setmetatable(a,{__index=a}); return a.x`)).rejects.toThrow("chain too long");
});

it("dispatches arithmetic metamethods with original operands and unary duplicates", async () => {
  expect(await execute(`local mt={
    __add=function(a,b) return b+10 end, __sub=function(a,b) return b+20 end,
    __mul=function(a,b) return b+30 end, __mod=function(a,b) return b+40 end,
    __pow=function(a,b) return b+50 end, __div=function(a,b) return b+60 end,
    __idiv=function(a,b) return b+70 end, __band=function(a,b) return b+80 end,
    __bor=function(a,b) return b+90 end, __bxor=function(a,b) return b+100 end,
    __shl=function(a,b) return b+110 end, __shr=function(a,b) return b+120 end,
    __unm=function(a,b) return rawequal(a,b) end, __bnot=function(a,b) return rawequal(a,b) end}
    local a=setmetatable({},mt)
    return a+1,a-1,a*1,a%1,a^1,a/1,a//1,a&1,a|1,a~1,a<<1,a>>1,-a,~a`))
    .toEqual([...[11,21,31,41,51,61,71,81,91,101,111,121].map(integer),true,true]);
});

it("resumes comparison callbacks and reversed less-than fallback for less-or-equal", async () => {
  expect(await execute(`local mt={__lt=function(a,b) return a.n<b.n end,
    __eq=function(a,b) return a.n==b.n end}
    local a=setmetatable({n=1},mt); local b=setmetatable({n=2},mt); local c=setmetatable({n=1},mt)
    local out=0; if a<b then out=out+1 end; if b<=a then out=100 end
    if a==c then out=out+10 end
    return out,a<=c,a<=b,b<a,a~=b,rawequal(a,c)`))
    .toEqual([integer(11),true,true,false,true,false]);
});

it("resumes right-associated concatenation around metamethod calls", async () => {
  expect(await execute(`local mt={__concat=function(a,b)
      if type(a)=="table" then a=a.n end; if type(b)=="table" then b=b.n end
      return "("..a..b..")" end}
    local a=setmetatable({n="a"},mt); local b=setmetatable({n="b"},mt)
    return "x"..a..b.."y",a..b.."z"..4`))
    .toEqual(["x(a(by))","(a(bz4))"]);
});

it.each(["setmetatable({})", "getmetatable()", "rawget({})", "rawset({},1)", "rawequal()", "type()"])
("preserves missing-argument errors in native base functions: %s", async call => {
  await expect(execute(`return ${call}`)).rejects.toThrow("Value expected");
});

it("uses right-operand methods and Lua truthiness for comparison results", async () => {
  expect(await execute(`local b=setmetatable({}, {__add=function(a,b) return a+4 end,
    __le=function(a,b) return 0 end, __eq=function(a,b) return false end})
    return 3+b,{}<=b,b==b,{}==b`)).toEqual([integer(7),true,true,false]);
});

it("cancels inside a suspended metamethod and removes all backing state", async () => {
  const controller = new AbortController(), timer = setTimeout(() => controller.abort(), 20);
  try {
    await expect(execute(`local t=setmetatable({}, {__index=function() while true do end end}); return t.x`, [], controller.signal))
      .rejects.toMatchObject({code: "E_CANCELLED"});
  } finally {clearTimeout(timer);}
});


it("closes an interrupted native result producer and cleans backing files", async () => {
  const controller = new AbortController();
  let closed = false;
  await expect(execute("return identity()", [], controller.signal, async function* () {
    try {yield undefined; controller.abort(); yield undefined;} finally {closed = true;}
  })).rejects.toMatchObject({code: "E_CANCELLED"});
  expect(closed).toBe(true);
});


it("preserves native failure identity and closes its producer", async () => {
  const failure = new Error("native failure");
  let closed = false;
  await expect(execute("return identity()", [], undefined, async function* () {
    try {yield integer(1); throw failure;} finally {closed = true;}
  })).rejects.toBe(failure);
  expect(closed).toBe(true);
});


it("preserves method receivers while index callbacks return Lua functions", async () => {
  expect(await execute(`local methods={add=function(self,n) return self.x+n end}
    local proxy=setmetatable({}, {__index=function(t,k) return methods[k] or 8 end})
    return proxy:add(3)`)).toEqual([integer(11)]);
});
