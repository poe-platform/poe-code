import {expect,it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import runtime from "./fengari.generated.js";
import {ExecutionContext} from "./execution.js";
import {LuaStorage} from "./lua-storage.js";
import {LuaProgram} from "./lua-program.js";
import {LuaFrames} from "./lua-frames.js";
import {LuaMachine,type LuaNative,type LuaArguments,type LuaNativeContext} from "./lua-machine.js";
import {LuaMath} from "./lua-math.js";
import {LuaBase} from "./lua-base.js";
import {LuaLexer} from "./lua-lexer.js";
import {LuaSyntax} from "./lua-syntax.js";
import {LuaParser} from "./lua-parser.js";
import {LuaCompiler} from "./lua-compiler.js";

async function execute(source: string,options: {signal?: AbortSignal; beforeRun?():void;
  native?(heap: LuaStorage,prototype: number,args: LuaArguments,context: LuaNativeContext):ReturnType<LuaNative>}={}):Promise<unknown[]> {
  const fs=new MemoryFileSystem(), execution=new ExecutionContext("convert",options.signal?{signal:options.signal}:{});
  const storage=new PagedStorage({fs,cwd:"/",env:{},signal:options.signal ?? new AbortController().signal},1);
  const cooperate=(units?:number)=>execution.cooperate(units), heap=new LuaStorage(storage,cooperate), program=new LuaProgram(storage,heap,cooperate);
  const syntax=new LuaSyntax(heap), lexer=new LuaLexer((async function*(){yield new TextEncoder().encode(source);})(),heap,cooperate);
  try {
    const root=await new LuaParser(lexer,syntax).parse(), prototype=await new LuaCompiler(heap,program,syntax).compile(root);
    const base=new LuaBase(heap), environment=await heap.table(); await base.install(environment);
    const math=new LuaMath(heap); await math.install(environment);
    if(options.native) await heap.set(environment,await heap.string([new TextEncoder().encode("host")]),await heap.closure(-1000,[]));
    const machine=new LuaMachine(program,new LuaFrames(storage,heap,cooperate),heap,cooperate,(prototype,args,context)=>
      prototype===-1000 && options.native?options.native(heap,prototype,args,context):prototype<=-200 && prototype>-300?math.invoke(prototype,args,context):base.invoke(prototype,args,context));
    const closure=await heap.closure(prototype,[await heap.cell(environment)]);
    options.beforeRun?.();
    const result=await machine.run(closure,[]), values:unknown[]=[];
    for(let i=0;i<result.count;i++) {
      const value=await heap.get(result.values,i);
      if(typeof value==="object" && value.kind==="string") {
        const decoder=new TextDecoder(); let text="";
        for await(const bytes of heap.bytes(value)) text+=decoder.decode(bytes,{stream:true});
        values.push(text+decoder.decode());
      } else values.push(value);
    }
    return values;
  } finally {await lexer.close(); await storage.close(); await execution.close(); expect(await fs.readdir("/")).toEqual([]);}
}
function native(source:string):unknown[] {
  const compiler=runtime as typeof import("fengari"), state=compiler.lauxlib.luaL_newstate(), bytes=new TextEncoder().encode(source);
  try {
    compiler.lauxlib.luaL_requiref(state,new TextEncoder().encode("_G"),compiler.lualib.luaopen_base,true); compiler.lua.lua_pop(state,1);
    compiler.lauxlib.luaL_requiref(state,new TextEncoder().encode("math"),compiler.lualib.luaopen_math,true); compiler.lua.lua_pop(state,1);
    expect(compiler.lauxlib.luaL_loadbuffer(state,bytes,bytes.length,new TextEncoder().encode("fixture"))).toBe(compiler.lua.LUA_OK);
    expect(compiler.lua.lua_pcall(state,0,-1,0)).toBe(compiler.lua.LUA_OK);
    const internal=state as unknown as {top:number; stack:{type:number; value:unknown}[]};
    return internal.stack.slice(1,internal.top).map(value=>value.type===0?undefined:value.type===19?{kind:"integer",value:value.value}:
      value.type===4 || value.type===20?new TextDecoder().decode((value.value as {getstr():Uint8Array}).getstr()):value.value);
  } finally {compiler.lua.lua_close(state);}
}

it("resumes native callbacks with backed local state, original arguments and nil result slots",async()=>{
  const result=await execute("local function f(x) return x,nil,3,nil end; return host(f,7)",{native:async(heap,_prototype,args,context)=>{
    if(context.continuation===0) {
      await heap.set(context.state,0,await args.get(1));
      return {call:{callee:await args.get(0),args:[await args.get(1)]},continuation:1};
    }
    expect(context.results.count).toBe(4);
    expect(await args.get(1)).toEqual(await heap.get(context.state,0));
    return (async function*(){for(let i=0;i<context.results.count;i++) yield await context.results.get(i);})();
  }});
  expect(result).toEqual([{kind:"integer",value:7},undefined,{kind:"integer",value:3},undefined]);
});
it("does not retain native JavaScript activations across recursive Lua callbacks",async()=>{
  let active=0,maximum=0;
  const result=await execute("local function f(n) if n==0 then return 0 end; return host(f,n-1) end; return f(64)",{
    native:async(heap,_prototype,args,context)=>{
      active++; maximum=Math.max(maximum,active);
      try {
        if(context.continuation===0) {
          await heap.set(context.state,0,await args.get(1));
          return {call:{callee:await args.get(0),args:[await args.get(1)]},continuation:1};
        }
        const result=await context.results.get(0), saved=await heap.get(context.state,0);
        expect(result).toEqual(saved);
        return [{kind:"integer",value:(result as {value:number}).value+1}];
      } finally {active--;}
    }
  });
  expect(result).toEqual([{kind:"integer",value:64}]); expect(maximum).toBe(1);
});

it.each([
  "return tostring(nil),tostring(false),tostring(7),tostring(7.0),_VERSION,rawequal(_G,_G)",
  "local t=setmetatable({}, {__tostring=function() return 'custom' end}); return tostring(t)",
  "local t=setmetatable({}, {__tostring=function() return 17 end}); return tostring(t)",
  "local t=setmetatable({}, {__tostring=function() return tostring(setmetatable({}, {__tostring=function() return 'nested' end})) end}); return tostring(t)",
  "local sum=0; for k,v in pairs({a=2,b=3}) do sum=sum+v end; return sum",
  "local f,s,k=pairs(nil); return rawequal(f,next),s,k",
  "local t=setmetatable({}, {__pairs=function(self) return function(_,k) if not k then return 'a',7 end end,self,nil,99 end}); local sum=0; for k,v in pairs(t) do sum=sum+v end; return sum",
  "local n=0; local t=setmetatable({}, {__index=function(_,k) if k<4 then return k*2 end end}); for i,v in ipairs(t) do n=n+i+v end; return n",
  "local n=0; for i,v in ipairs({1,2,nil,4}) do n=n+v end; return n",
  "return select('#',1,nil,3,nil),select('#suffix',7,8),select(2,1,nil,3,nil)",
  "return select(-2,1,nil,3,nil)",
  "return assert(1,nil,3,nil)",
  "return tonumber('17'),tonumber('1.5'),tonumber('0xff'),tonumber('bad'),tonumber(false),tonumber(nil),tonumber(3.0)",
  "return tonumber('  -ff ',16),tonumber('11z',2),tonumber('0x10',16),tonumber('000',2),tonumber('000a',10)",
  "return tonumber('4294967297',10),tonumber('9007199254740993',10),tonumber('zzz',36),tonumber('11x!',2)"
])("matches enabled base-library semantics: %s",async source=>{expect(await execute(source)).toEqual(native(source));});

it.each(["select(0,1)","tonumber('10',1)","tonumber(10,2)","tostring(setmetatable({}, {__tostring=function() return {} end}))"])
("rejects invalid base-library arguments: %s",async source=>{await expect(execute(source)).rejects.toMatchObject({code:"E_AST"});});

it("keeps the public filter's disabled base operations unavailable",async()=>{
  expect(await execute("return type(pcall),type(xpcall),type(load),type(loadfile),type(dofile),type(print),type(collectgarbage)"))
    .toEqual(["nil","nil","nil","nil","nil","nil","nil"]);
});
it("cancels inside a Lua callback requested by a native operation and cleans backing storage",async()=>{
  const controller=new AbortController(); let timer:ReturnType<typeof setTimeout>|undefined;
  try {await expect(execute("return tostring(setmetatable({}, {__tostring=function() while true do end end}))",{
    signal:controller.signal,beforeRun(){timer=setTimeout(()=>controller.abort(),0);}
  })).rejects.toMatchObject({code:"E_CANCELLED"});} finally {clearTimeout(timer);}
});

it("keeps callback results stable while a native operation streams a longer output",async()=>{
  const result=await execute("return host(function() return 1,nil,3 end)",{native:async(heap,_prototype,args,context)=>{
    if(context.continuation===0) return {call:{callee:await args.get(0),args:[]},continuation:1};
    return (async function*(){
      yield await heap.string([new TextEncoder().encode("prefix")]);
      for(let i=0;i<context.results.count;i++) yield await context.results.get(i);
    })();
  }});
  expect(result).toEqual(["prefix",{kind:"integer",value:1},undefined,{kind:"integer",value:3}]);
});

it.each(["call","values"])("normalizes cancellation when a native handler returns %s",async form=>{
  const controller=new AbortController();
  await expect(execute("return host(function() return 1 end)",{signal:controller.signal,native:async(_heap,_prototype,args)=>{
    const callee=await args.get(0); controller.abort();
    return form==="call"?{call:{callee,args:[]},continuation:1}:[];
  }})).rejects.toMatchObject({code:"E_CANCELLED"});
});
it.each(["rawset({},nil,1)","rawset({},0/0,1)","next({},'missing')"])
("reports invalid table keys as Lua errors: %s",async source=>{
  await expect(execute(source)).rejects.toMatchObject({code:"E_AST"});
});


it.each([
  "return math.pi,math.huge,math.mininteger,math.maxinteger",
  "return math.abs(-7),math.abs(-7.0),math.abs(-2147483648),math.floor(2.7),math.ceil(-2.7),math.floor(1e30)",
  "return math.sin(1),math.cos(1),math.tan(1),math.asin(.5),math.acos(.5),math.atan(1),math.atan(1,2)",
  "return math.sqrt(2),math.exp(2),math.log(8,2),math.log(100,10),math.log(7,3),math.log(2),math.deg(1),math.rad(90)",
  "return math.fmod(-7,3),math.fmod(-7.0,3),math.modf(-3.25)",
  "return math.modf(math.huge)",
  "return math.modf(7)",
  "return math.tointeger('7'),math.tointeger(7.5),math.tointeger(false),math.tointeger(nil),math.type(7),math.type(7.0),math.type('7'),math.ult(-1,0),math.ult(0,-1)",
  "return math.min(3,2.0,2),math.max(2.0,2,1),math.min('b','a'),math.max('a','b')",
  "local mt={__lt=function(a,b) return a.x<b.x end}; local a=setmetatable({x=3},mt); local b=setmetatable({x=1},mt); local c=setmetatable({x=5},mt); return math.min(a,b,c).x,math.max(a,b,c).x",
  "local mt={__lt=function(a,b) return math.min(a.x,b.x)==a.x end}; return math.min(setmetatable({x=3},mt),setmetatable({x=1},mt)).x",
  "math.randomseed(17); return math.random(),math.random(10),math.random(-10,10)",
  "math.randomseed(0); return math.random(),math.random(1)",
  "return math.abs('7'),math.ceil('7.5'),math.tointeger('2147483648')"
])("preserves retained math library behavior: %s",async source=>{expect(await execute(source)).toEqual(native(source));});
it.each(["math.min()","math.max()","math.type()","math.tointeger()","math.fmod(1,0)","math.ult(1.5,2)","math.random(0)","math.random(-2147483648,2147483647)","math.random(1,2,3)"])("reports math argument errors: %s",async source=>{await expect(execute(source)).rejects.toMatchObject({code:"E_AST"});});

it.each([
  "return math.abs(-0.0),math.ceil(-0.25),math.floor(0/0),math.ceil(-math.huge),math.modf(0/0)",
  "local z=math.ceil(-0.25); local t={[z]=17}; return 1/z,1/math.tointeger(z),1/math.abs(z),t[0],math.type(z)",
  "return math.fmod(1.0,0),math.fmod(-2147483648,-1),math.tointeger(math.huge),math.tointeger('bad')",
  "return math.min(0/0,2),math.max(2,0/0),math.max(2,2.0),math.min(2,2.0)",
  "local mt={__lt=function() return 0 end}; local a=setmetatable({x=1},mt); local b=setmetatable({x=2},mt); return math.min(a,b).x",
  "math.randomseed(17.75); return math.random(),math.random(-2147483648,-2147483648)"
])("preserves math numeric and comparator edge behavior: %s",async source=>{expect(await execute(source)).toEqual(native(source));});
it("cancels a suspended math comparator and cleans up caller storage",async()=>{
  const controller=new AbortController();
  await expect(execute("local mt={__lt=function() while true do end end}; return math.min(setmetatable({},mt),setmetatable({},mt))",{
    signal:controller.signal,beforeRun(){setTimeout(()=>controller.abort(),0);}
  })).rejects.toMatchObject({code:"E_CANCELLED"});
});
it("scans variadic math arguments through backed frames with a single cache page",async()=>{
  const source=`return math.min(${Array.from({length:180},(_,i)=>180-i).join(",")})`;
  expect(await execute(source)).toEqual(native(source));
});
