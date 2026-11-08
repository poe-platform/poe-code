import {expect,it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {luaAst} from "./lua-ast.js";
import runtime from "./fengari.generated.js";
import {ExecutionContext} from "./execution.js";
import {LuaStorage,type StoredLuaValue} from "./lua-storage.js";
import {LuaProgram} from "./lua-program.js";
import {LuaBase} from "./lua-base.js";
import {LuaFrames} from "./lua-frames.js";
import {LuaMachine} from "./lua-machine.js";
import {LuaLexer} from "./lua-lexer.js";
import {LuaSyntax} from "./lua-syntax.js";
import {LuaParser} from "./lua-parser.js";
import {LuaCompiler} from "./lua-compiler.js";

async function execute(source: string, options: {compileOnly?: boolean; base?: boolean; cachePages?: number; signal?: AbortSignal; beforeCompile?(): void} = {}): Promise<unknown[]> {
  const fs=new MemoryFileSystem(), context=new ExecutionContext("convert",options.signal?{signal:options.signal}:{});
  const storage=new PagedStorage({fs,cwd:"/",env:{},signal:options.signal ?? new AbortController().signal},options.cachePages ?? 1);
  const cooperate=(units?: number) => context.cooperate(units), heap=new LuaStorage(storage,cooperate);
  const program=new LuaProgram(storage,heap,cooperate), syntax=new LuaSyntax(heap);
  const chunks=(async function* () {const bytes=new TextEncoder().encode(source); for(let i=0;i<bytes.length;i+=17) yield bytes.subarray(i,i+17);})();
  const lexer=new LuaLexer(chunks,heap,cooperate);
  try {
    const root=await new LuaParser(lexer,syntax).parse();
    options.beforeCompile?.();
    const prototype=await new LuaCompiler(heap,program,syntax).compile(root);
    if(options.compileOnly) return [(await program.describe(prototype)).instructions];
    const environment=await heap.table(), closure=await heap.closure(prototype,[await heap.cell(environment)]), base=new LuaBase(heap);
    if(options.base) await base.install(environment);
    const machine=new LuaMachine(program,new LuaFrames(storage,heap,cooperate),heap,cooperate,(prototype,args,context)=>base.invoke(prototype,args,context));
    const result=await machine.run(closure,[]), values: unknown[]=[];
    for(let i=0;i<result.count;i++) {
      const value=await heap.get(result.values,i);
      if(typeof value === "object" && value.kind === "string") {
        let text=""; const decoder=new TextDecoder();
        for await(const bytes of heap.bytes(value)) text+=decoder.decode(bytes,{stream:true});
        values.push(text+decoder.decode());
      } else values.push(value);
    }
    return values;
  } finally {await lexer.close(); await storage.close(); await context.close(); expect(await fs.readdir("/")).toEqual([]);}
}
function native(source: string): unknown[] {
  const compiler=runtime as typeof import("fengari"), state=compiler.lauxlib.luaL_newstate(), bytes=new TextEncoder().encode(source);
  try {
    compiler.lauxlib.luaL_requiref(state,new TextEncoder().encode("_G"),compiler.lualib.luaopen_base,true);
    compiler.lua.lua_pop(state,1);
    expect(compiler.lauxlib.luaL_loadbuffer(state,bytes,bytes.length,new TextEncoder().encode("fixture"))).toBe(compiler.lua.LUA_OK);
    expect(compiler.lua.lua_pcall(state,0,-1,0)).toBe(compiler.lua.LUA_OK);
    const internal=state as unknown as {top: number; stack: {type: number; value: unknown}[]};
    return internal.stack.slice(1,internal.top).map(value => {
      if(value.type===0) return undefined;
      if(value.type===19) return {kind:"integer",value:value.value};
      if(value.type===4 || value.type===20) return new TextDecoder().decode((value.value as {getstr(): Uint8Array}).getstr());
      return value.value;
    });
  } finally {compiler.lua.lua_close(state);}
}

const programs=[
  "return nil,true,false,3,3.0,'hello'",
  "local function f() local old=_ENV; x,_ENV=3,{}; return old.x,x end; return f()",
  "local t={x=1}; local function f() local old=t; t.x,t=3,{}; return old.x,t.x end; return f()",
  "local f; do local x=7; f=function() return x end; goto finish end; ::finish:: local x=9; return f(),x",
  "local i=1; local t={}; t[i],i,t[i]=1,2,3; return i,t[1],t[2]",
  "return 'x' .. 3.0 .. 'y',2^3^2,1+2*3,~3.0,-2^2,(-2)^2",
  "local t={x=1}; local function key() t={x=3}; return 'x' end; local function get() return t[key()] end; return get()",
  "local t={x=1}; local function value() t={x=3}; return 2 end; local function put() t.x=value() end; put(); return t.x",
  "return -0.0,0.0,-(0.0),~3.0,(2147483647+1),1.0/0.0,0.0/0.0",
  "local x=0; repeat local y=x; x=x+1; if x==2 then break end until y>5; return x",
  "local f; repeat local x=7; f=function() return x end until true; local x=9; return f()",
  "local t={}; local i=1; t[i],i=9,2; return i,t[1],t[2]",
  "local _ENV={}; local old=_ENV; x,_ENV=3,{}; return old.x,x",
  "local x=1; local function f() local old=_ENV; x,_ENV=3,{}; return old.x,x end; return f()",
  "local function f() return 1,2,3 end; local t={f(),x=9,f()}; return t[1],t[2],t[3],t[4],t.x",
  "local n=0; ::again:: do n=n+1; if n==2 then goto done end; goto again end; ::done:: return n",
  "local function f(...) return ... end; return f()",
  "local a,b,c; return a,b,c",
  "local a,b,c=1; return a,b,c",
  "local n=0; local function f() n=n+1; return n end; local a=f(),f(),f(); return a,n",

  "local a,b=7,2; return a+b,a-b,a*b,a/b,a//b,a%b,a^b,a&b,a|b,a~b,a<<b,a>>b,-a,~a,not a",
  "local a,b=2,3; return a<b,a<=b,a>b,a>=b,a==b,a~=b,not nil,not false",
  "local a=0; local function inc() a=a+1; return a end; return false and inc(),true or inc(),nil or inc(),a",
  "local x=4; local function f(a,...) return x+a,... end; return f(3,8,nil,9)",
  "local function f() return 1,2,3 end; local a,b,c,d=0,f(); return a,b,c,d,(f())",
  "local a,b=1,2; a,b=b,a; return a,b",
  "local a=0; a,a=1,2; return a",
  "local t={x=1,[3]=5,7,8}; return t.x,t[1],t[2],t[3],#t",
  "local t={x=2}; function t:add(n) return self.x+n end; return t:add(3)",
  "local t={}; local i=1; i,t[i]=2,9; return i,t[1],t[2]",
  "local total=0; for i=1,10,2 do total=total+i end; return total",
  "local n=0; while n<5 do n=n+1; if n==3 then break end end; return n",
  "local n=0; repeat local x=n+1; n=x until x==4; return n",
  "local n=2; if n==1 then return 'a' elseif n==2 then return 'b' else return 'c' end",
  "local function iter(s,i) i=i+1; if i<=s then return i,i*2 end end; local sum=0; for k,v in iter,3,0 do sum=sum+k+v end; return sum",
  "local x=0; ::again:: x=x+1; if x<3 then goto again end; return x",
  "local f; do local x=7; f=function() return x end end; local x=9; return f(),x",
  "local function f(n,acc) if n==0 then return acc end; return f(n-1,acc+1) end; return f(128,0)",
  "local function f() return 2,3 end; local t={1,f()}; return t[1],t[2],t[3]",
  "local function f(...) return ... end; local function g() return 2,3 end; return f(1,g())",
  "local _ENV={x=7}; return x",
  "local x=1; local f=function() return x end; local x=2; return f(),x",
  "local f={}; for i=1,3 do f[i]=function() return i end end; return f[1](),f[2](),f[3]()",
  "local t={x=1}; local function f() t={x=3}; return 2 end; t.x=f(); return t.x",
  "local x=1; local function f() x=3; return 2 end; return x+f()"
];
it.each(programs)("compiles and executes through caller-backed state: %s",async source => {
  expect(await execute(source)).toEqual(native(source));
});
it.each(["break","goto missing","goto later; local x=1; ::later:: return x","local function f() return ... end"])
("rejects invalid control flow or vararg scope: %s",async source => {
  await expect(execute(source)).rejects.toMatchObject({code:"E_AST"});
});
it("walks a wide left-associated expression without a resident compiler stack",async () => {
  const source="local x=1; return x"+"+x".repeat(128);
  expect(await execute(source)).toEqual([{kind:"integer",value:129} satisfies StoredLuaValue]);
});

it("folds numeric syntax before allocating registers at the existing active-local limit",async () => {
  const source="local "+Array.from({length:200},(_,i)=>`v${i}`).join(",")+"; return "+"-1+(".repeat(60)+"1"+")".repeat(60);
  expect(await execute(source)).toEqual(native(source));
});

it("compiles the shipped Pandoc constructors and traversal without resident bytecode or AST arrays",async () => {
  expect((await execute(luaAst,{compileOnly:true,cachePages:64}))[0]).toBeGreaterThan(100);
});
it("cancels during retained compilation and cleans up caller storage",async () => {
  const controller=new AbortController(); let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await expect(execute("local x=0;"+"x=x+1;".repeat(128),{signal:controller.signal,beforeCompile() {timer=setTimeout(()=>controller.abort(),0);}}))
      .rejects.toMatchObject({code:"E_CANCELLED"});
  } finally {clearTimeout(timer);}
});
it.each([49,50,51,101])("preserves table array batches and trailing multiple results at %s entries",async count => {
  const source="local function f() return 7,8 end; local t={"+"1,".repeat(count)+"f()}; return #t,t["+(count+1)+"],t["+(count+2)+"]";
  expect(await execute(source)).toEqual(native(source));
});

it("loads constants beyond the RK operand range while preserving tagged numeric constants",async () => {
  const source="local t={};"+Array.from({length:140},(_,i)=>`t.k${i}=${i};`).join("")+"return t.k139,139.0";
  expect(await execute(source)).toEqual(native(source));
});

it.each([
  "return type(1)",
  "local t=setmetatable({}, {__index=function(_,k) return k end}); return t.a",
  "local out=''; local t=setmetatable({}, {__newindex=function(_,k,v) out=out..k end}); t.x,t.y=1,2; return out",
  "local mt={__add=function(a,b) return a.x+b.x end,__unm=function(a) return -a.x end}; local t=setmetatable({x=3},mt); return t+t,-t",
  "local mt={__concat=function(a,b) return '('..(type(a)=='table' and a.x or a)..(type(b)=='table' and b.x or b)..')' end}; local t=setmetatable({x='x'},mt); return t..t..t",
  "local mt={__lt=function(a,b) return a.x<b.x end}; local a=setmetatable({x=1},mt); local b=setmetatable({x=2},mt); return a<b,a<=b,a>b,a>=b"
])("preserves native calls and metamethod evaluation from retained source: %s",async source => {
  expect(await execute(source,{base:true})).toEqual(native(source));
});
