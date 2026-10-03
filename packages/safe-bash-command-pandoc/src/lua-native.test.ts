import {expect,it,vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import runtime from "./fengari.generated.js";
import {ExecutionContext} from "./execution.js";
import {LuaStorage} from "./lua-storage.js";
import {LuaProgram} from "./lua-program.js";
import {LuaFrames} from "./lua-frames.js";
import {LuaMachine,type LuaNative,type LuaArguments,type LuaNativeContext} from "./lua-machine.js";
import {LuaStringLibrary} from "./lua-string-library.js";
import {LuaTable} from "./lua-table.js";
import {LuaUtf8} from "./lua-utf8.js";
import {LuaMath} from "./lua-math.js";
import {LuaBase} from "./lua-base.js";
import {LuaLexer} from "./lua-lexer.js";
import {LuaSyntax} from "./lua-syntax.js";
import {LuaParser} from "./lua-parser.js";
import {LuaCompiler} from "./lua-compiler.js";

async function execute(source: string,options: {string?:boolean;pages?:number;table?:boolean;signal?: AbortSignal; beforeRun?():void;
  native?(heap: LuaStorage,prototype: number,args: LuaArguments,context: LuaNativeContext):ReturnType<LuaNative>}={}):Promise<unknown[]> {
  const fs=new MemoryFileSystem(), execution=new ExecutionContext("convert",options.signal?{signal:options.signal}:{});
  const storage=new PagedStorage({fs,cwd:"/",env:{},signal:options.signal ?? new AbortController().signal},options.pages ?? (options.table?64:1));
  const cooperate=(units?:number)=>execution.cooperate(units), heap=new LuaStorage(storage,cooperate), program=new LuaProgram(storage,heap,cooperate);
  const syntax=new LuaSyntax(heap), lexer=new LuaLexer((async function*(){yield new TextEncoder().encode(source);})(),heap,cooperate);
  try {
    const root=await new LuaParser(lexer,syntax).parse(), prototype=await new LuaCompiler(heap,program,syntax).compile(root);
    const base=new LuaBase(heap), environment=await heap.table(); await base.install(environment);
    const math=new LuaMath(heap); await math.install(environment);
    const utf8=new LuaUtf8(heap); await utf8.install(environment);
    if(options.native) await heap.set(environment,await heap.string([new TextEncoder().encode("host")]),await heap.closure(-1000,[]));
    const table=new LuaTable(heap);
    const strings=new LuaStringLibrary(heap,cooperate);
    const machine=new LuaMachine(program,new LuaFrames(storage,heap,cooperate),heap,cooperate,(prototype,args,context)=>
      prototype===-1000 && options.native?options.native(heap,prototype,args,context):prototype<=-200 && prototype>-300?math.invoke(prototype,args,context):prototype<=-300 && prototype>-400?utf8.invoke(prototype,args):prototype<=-400 && prototype>-500?table.invoke(prototype,args):prototype<=-500 && prototype>-600?strings.invoke(prototype,args):base.invoke(prototype,args,context));
    if(options.string) await strings.install(environment,program,machine);
    if(options.table) await table.install(environment,program,machine);
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
    compiler.lauxlib.luaL_requiref(state,new TextEncoder().encode("utf8"),compiler.lualib.luaopen_utf8,true); compiler.lua.lua_pop(state,1);
    compiler.lauxlib.luaL_requiref(state,new TextEncoder().encode("table"),compiler.lualib.luaopen_table,true); compiler.lua.lua_pop(state,1);
    compiler.lauxlib.luaL_requiref(state,new TextEncoder().encode("string"),compiler.lualib.luaopen_string,true); compiler.lua.lua_pop(state,1);
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


it.each([
  "return utf8.char(),utf8.char(65,8364,128512),utf8.len('a€😀'),utf8.codepoint('a€😀',1,-1)",
  "return utf8.len('a€😀',2,2),utf8.len('abc',4),utf8.len('abc',2,0),utf8.codepoint('abc',4,3)",
  "return utf8.codepoint(123,1,-1),utf8.len(123),utf8.codepoint('€',1,1)",
  "return utf8.codepoint(utf8.char(55296)),utf8.codepoint(utf8.char(1114111))",
  "return utf8.offset('a€😀',1),utf8.offset('a€😀',2),utf8.offset('a€😀',3),utf8.offset('a€😀',4),utf8.offset('a€😀',5)",
  "return utf8.offset('a€😀',-1),utf8.offset('a€😀',-2),utf8.offset('a€😀',-3),utf8.offset('a€😀',-4),utf8.offset('a€😀',0,3)",
  "return utf8.offset('',0),utf8.offset('',1),utf8.offset('',-1),utf8.offset('abc',1,-1)",
  "local text=''; for i,c in utf8.codes('a€😀') do text=text..i..':'..c..';' end; return text",
  "local f,s,i=utf8.codes('abc'); return f(s,'bad')",
  "return utf8.len('a\\255b')",
  "return utf8.len('\\192\\128'),utf8.len('\\244\\144\\128\\128')",
  "return utf8.len('a\\128'),utf8.charpattern"
])("preserves retained UTF-8 semantics: %s",async source=>{expect(await execute(source)).toEqual(native(source));});
it.each([
  "utf8.char(-1)","utf8.char(1114112)","utf8.char(1.5)","utf8.len('a',0)","utf8.len('a',1,2)",
  "utf8.codepoint('a',0)","utf8.codepoint('a',1,2)","utf8.codepoint('\\255')",
  "utf8.offset('€',1,2)","utf8.offset('a',1,0)","for i,c in utf8.codes('a\\128') do end"
])("reports UTF-8 errors: %s",async source=>{await expect(execute(source)).rejects.toMatchObject({code:"E_AST"});});


it("reads UTF-8 across backing pages without copying its input string",async()=>{
  const text="a".repeat(8191)+"€😀";
  const result=await execute("local s=host(); local f,state=utf8.codes(s); local p,c=f(state,8191); return utf8.len(s),utf8.offset(s,-1),utf8.codepoint(s,8192,8192),p,c",{native:async heap=>{
    const value=await heap.string([new TextEncoder().encode(text)]);
    vi.spyOn(heap,"string").mockRejectedValue(new Error("Unexpected string copy"));
    return [value];
  }});
  expect(result).toEqual([8193,8195,8364,8192,8364].map(value=>({kind:"integer",value})));
});

it("cancels while scanning UTF-8 bytes and cleans up indexed storage",async()=>{
  const controller=new AbortController();
  await expect(execute("return utf8.len(host())",{signal:controller.signal,native:async heap=>{
    const value=await heap.string([new Uint8Array(32768).fill(65)]),read=heap.readBytes.bind(heap);
    let scheduled=false;
    vi.spyOn(heap,"readBytes").mockImplementation(async(...args)=>{
      const result=await read(...args);
      if(!scheduled) {scheduled=true;setTimeout(()=>controller.abort(),0);}
      return result;
    });
    return [value];
  }})).rejects.toMatchObject({code:"E_CANCELLED"});
});


it.each([
  "local t=table.pack(1,nil,3,nil); return t.n,table.unpack(t,1,t.n)",
  "local t={1,2,3}; table.insert(t,2,7); table.insert(t,9); local x=table.remove(t,3); return x,table.concat(t,':')",
  "local t={}; return table.remove(t),table.concat(t),select('#',table.unpack(t))",
  "local t={1,2}; return table.remove(t,3),t[1],t[2]",
  "local t={1,2,3,4}; table.move(t,1,3,2); return table.concat(t,':')",
  "local t={1,2,3,4}; table.move(t,2,4,1); return table.concat(t,':')",
  "local t={1,2,3}; local u={}; return rawequal(table.move(t,2,3,1,u),u),table.concat(u,':')",
  "return table.concat({1,2.0,3},7,2,3),table.concat({},nil,2,1)",
  "local t={5,3,1,4,2,2}; table.sort(t); return table.concat(t,':')",
  "local t={5,3,1,4,2}; table.sort(t,function(a,b) return a>b end); return table.concat(t,':')",
  "local t={{x=3},{x=1},{x=2}}; local mt={__lt=function(a,b) return a.x<b.x end}; for _,v in ipairs(t) do setmetatable(v,mt) end; table.sort(t); return t[1].x,t[2].x,t[3].x",
  "local values={3,1,2}; local events=''; local t=setmetatable({}, {__len=function() events=events..'L'; return 3 end,__index=function(_,i) events=events..'R'..i; return values[i] end,__newindex=function(_,i,v) events=events..'W'..i; values[i]=v end}); table.insert(t,2,7); return events,table.concat(values,':')",
  "local values={3,1,2}; local events=''; local t=setmetatable({}, {__len=function() events=events..'L'; return 3 end,__index=function(_,i) events=events..'R'..i; return values[i] end,__newindex=function(_,i,v) events=events..'W'..i; values[i]=v end}); table.remove(t,2); return events,table.concat(values,':')",
  "local t=setmetatable({}, {__len=function() return 3 end,__index=function(_,i) return i*2 end}); return table.unpack(t)",
  "local t=setmetatable({}, {__len=function() return 3 end,__index=function(_,i) return i*2 end}); return table.concat(t,':')",
  "local t={}; table.sort(t,false); return select('#',table.sort(t))",
  "local insert=table.insert; type=nil; math=nil; select=nil; table=nil; local t={1}; insert(t,2); return t[2]"
])("preserves retained table library behavior: %s",async source=>{expect(await execute(source,{table:true})).toEqual(native(source));});
it.each(["table.insert({},1,2,3)","table.insert({},0,1)","table.remove({1},0)","table.concat({true})","table.sort({1,2},false)","table.move({},-2147483648,0,1)","table.move({},1,2,2147483647)"])("reports table errors: %s",async source=>{await expect(execute(source,{table:true})).rejects.toMatchObject({code:"E_AST"});});

it.each([
  "local key,value; local t=setmetatable({}, {__len=function() return 2147483646 end,__index=function() error('unexpected read') end,__newindex=function(_,k,v) key=k; value=v end}); table.insert(t,2147483647,9); return key,value",
  "local values={4,1,5,2,3}; local events=''; local t=setmetatable({}, {__len=function() events=events..'L'; return 5 end,__index=function(_,i) events=events..'R'..i..';'; return values[i] end,__newindex=function(_,i,v) events=events..'W'..i..';'; values[i]=v end}); table.sort(t,function(a,b) events=events..'C'..a..','..b..';'; return a<b end); return events,table.concat(values,':')",
  "local values={1,2,3,4}; local events=''; local mt={__eq=function() events=events..'E'; return true end,__index=function(_,i) events=events..'R'..i; return values[i] end,__newindex=function(_,i,v) events=events..'W'..i; values[i]=v end}; local a=setmetatable({},mt); local b=setmetatable({},mt); table.move(a,1,3,2,b); return events,table.concat(values,':')",
  "local events=''; local t=setmetatable({}, {__len=function() events=events..'L'; return 7 end,__index=function(_,i) events=events..'R'..i; return i end}); local a,b=table.unpack(t,2,3); return events,a,b",
  "local t={1,1,1,1,1,1,1}; table.sort(t); return table.concat(t,':')"
])("preserves table bounds and callback order: %s",async source=>{expect(await execute(source,{table:true})).toEqual(native(source));});
it("runs table callbacks and streamed results with a single backing cache page",async()=>{
  const source="local t={5,2,4,1,3}; table.sort(t,function(a,b) return a<b end); local p=table.pack(table.unpack(t)); return p.n,table.concat(p,':')";
  expect(await execute(source,{table:true,pages:1})).toEqual(native(source));
});
it("cancels inside a table comparator and cleans up caller storage",async()=>{
  const controller=new AbortController();
  await expect(execute("table.sort({2,1},function() while true do end end)",{table:true,signal:controller.signal,
    beforeRun(){setTimeout(()=>controller.abort(),0);}})).rejects.toMatchObject({code:"E_CANCELLED"});
});

it.each([
  "local t={}; for i=1,31 do t[i]=(i*17)%31 end; table.sort(t); return table.concat(t,':')",
  "local t={4,1,3,2}; table.sort(t,function(a,b) local u={b,a}; table.sort(u); return a<b end); return table.concat(t,':')",
  "return select('#',table.unpack('abc',2,1))",
  "local t={[0]=7}; return table.remove(t),t[0]",
  "local t={}; table.move(t,2,1,2147483647); table.insert(t,nil); return select('#',table.unpack(t))"
])("preserves table recursion and empty ranges: %s",async source=>{expect(await execute(source,{table:true})).toEqual(native(source));});
it("rejects an inconsistent table comparator",async()=>{
  await expect(execute("table.sort({1,2,3,4,5},function() return true end)",{table:true})).rejects.toMatchObject({code:"E_AST"});
});

it("streams table unpack results beyond fixed registers while retaining nil slots",async()=>{
  const source="local t={}; for i=1,260 do if i~=19 then t[i]=i end end; local p=table.pack(table.unpack(t,1,260)); return p.n,p[19],p[260]";
  expect(await execute(source,{table:true})).toEqual(native(source));
});


it.each([
  "return string.len('a€'),string.len(123),string.char(),string.byte('abc',1,-1)",
  "return string.byte(string.char(0,127,128,255),1,-1)",
  "return string.sub('abcdef',2,4),string.sub('abcdef',-3),string.sub('abc',-99,99),string.sub('abc',3,1)",
  "return string.sub('abc',0,0),string.sub('abc',99),string.sub('abc',1,-99)",
  "return string.byte('abc'),string.byte('abc',-1),string.byte('abc',0),string.byte('abc',-99),select('#',string.byte('abc',2,1))",
  "return string.upper('aZä'),string.lower('AZÄ'),string.reverse('abcdef')",
  "return string.byte(string.reverse(string.char(0,128,255)),1,-1)",
  "return string.rep('ab',3,':'),string.rep('x',0),string.rep('x',-1),string.rep('',3,':'),string.rep('',3)",
  "return string.sub(12345,2,4),string.rep(12,3,7),string.reverse(123),string.upper(123)",
  "return ('abc'):sub(2):upper(),('abc'):byte(2),rawequal(getmetatable('').__index,string),rawequal(getmetatable('a'),getmetatable('b'))",
  "getmetatable('').__index=function(s,k) return s..k end; return ('x').hello",
  "getmetatable('').__call=function(s,x) return s..x end; local s='a'; return s('b')",
  "local saved; getmetatable('').__newindex=function(s,k,v) saved=s..k..v end; local s='a'; s.b='c'; return saved",
  "getmetatable('').__tostring=function(s) return s..'!' end; return tostring('hi')",
  "getmetatable('').__metatable='locked'; return getmetatable('x')"
])("preserves retained byte-string operations: %s",async source=>{expect(await execute(source,{string:true})).toEqual(native(source));});
it.each(["string.char(-1)","string.char(256)","string.char(1.5)","string.sub('x')","string.len(false)","string.rep('x',1.5)","string.rep('x',0,true)","string.rep('x',2147483647,':')"])("reports byte-string argument errors: %s",async source=>{await expect(execute(source,{string:true})).rejects.toMatchObject({code:"E_AST"});});

it.each([
  "local mt=getmetatable(''); mt.__len=function() return 99 end; mt.__index=function(_,i) return i*2 end; return table.concat('abc',':'),table.unpack('abc')",
  "local values={3,1,2}; local mt=getmetatable(''); mt.__len=true; mt.__index=function(_,i) return values[i] end; mt.__newindex=function(_,i,v) values[i]=v end; table.sort('abc'); return table.concat(values,':')",
  "local values={1,2}; local mt=getmetatable(''); mt.__index=function(_,i) return values[i] end; mt.__newindex=function(_,i,v) values[i]=v end; table.move('ab',1,2,2); return table.concat(values,':')"
])("uses string metatable capabilities in table operations: %s",async source=>{expect(await execute(source,{string:true,table:true})).toEqual(native(source));});

it("reads byte-string results across chunk boundaries without changing input bytes",async()=>{
  const source="local s=host(); local r=string.reverse(s); return #r,string.byte(r,1),string.byte(r,8192),string.byte(r,8193),string.byte(r,-1),string.byte(s,1)";
  const length=17003;
  const result=await execute(source,{string:true,native:async heap=>{
    const value=await heap.string((async function*(){const chunk=new Uint8Array(137);for(let start=0;start<length;start+=chunk.length){const count=Math.min(chunk.length,length-start);for(let i=0;i<count;i++)chunk[i]=(start+i)%251;yield chunk.subarray(0,count);}})());
    const read=heap.readBytes.bind(heap);
    vi.spyOn(heap,"readBytes").mockImplementation(async(value,start,count)=>{expect(count).toBeLessThanOrEqual(8192);return read(value,start,count);});
    return [value];
  }});
  expect(result).toEqual([length,(length-1)%251,(length-8192)%251,(length-8193)%251,0,0].map(value=>({kind:"integer",value})));
});
it("queries byte-string length and bytes without copying the retained input",async()=>{
  const result=await execute("local s=host(); return string.len(s),string.byte(s,2)",{string:true,native:async heap=>{
    const value=await heap.string([Uint8Array.of(65,66,67)]);
    vi.spyOn(heap,"string").mockRejectedValue(new Error("Unexpected input copy"));
    return [value];
  }});
  expect(result).toEqual([3,66].map(value=>({kind:"integer",value})));
});
it.each([
  "local s=string.rep('ab',5000,':'); return #s,string.sub(s,8188,8200),string.sub(s,-7)",
  "local s=string.rep('a',8192)..'Bz'; return #s,string.sub(string.upper(s),8189),string.sub(string.lower(s),8189),string.sub(s,8189)",
  "local s=string.rep('ab',5000); local r=string.rep(s,3,':'); return #r,string.sub(r,9998,10005),string.sub(r,-4)"
])("streams string transformations across retained chunks: %s",async source=>{expect(await execute(source,{string:true})).toEqual(native(source));});
it("returns an empty repetition without iterating over an empty pattern",async()=>{
  expect(await execute("return string.rep('',2147483647)",{string:true})).toEqual([""]);
});
it("cancels while producing repeated string bytes and cleans up storage",async()=>{
  const controller=new AbortController();
  await expect(execute("return string.rep(host(),40000)",{string:true,signal:controller.signal,native:async heap=>{
    const value=await heap.string([Uint8Array.of(65)]),read=heap.readBytes.bind(heap);
    let scheduled=false;
    vi.spyOn(heap,"readBytes").mockImplementation(async(...args)=>{const result=await read(...args);if(!scheduled){scheduled=true;setTimeout(()=>controller.abort(),0);}return result;});
    return [value];
  }})).rejects.toMatchObject({code:"E_CANCELLED"});
});

it.each([
  "return string.find('abcabc','bc'),string.match('abc123','%a+'),string.find('abc','x')",
  "return string.find('a.b','.',1,true)",
  "return string.find('abc','',4),string.find('abc','',5),string.find('abc','b',-2)",
  "return string.find('abc123','(%a+)(%d+)')",
  "return string.match('abc123','()(%a+)()(%d+)()')",
  "return string.match('one two','%f[%a]%a+'),string.match('word','%f[%z]')",
  "return string.match('x(a(b)c)y','%b()'),string.match('q[abc]r','%b[]')",
  "return string.match('abc-abc','(%a+)%-%1'),string.match('abc-def','(%a+)%-%1')",
  "return string.match('aaaab','a-b'),string.match('ab','a?b'),string.match('b','a?b')",
  "return string.match('abcd','^a.*d$'),string.match('xabc','^abc',2),string.match('abc','a$')",
  "return string.match('abc123','[^%d]+'),string.match('ABC','[a-zA-Z]+'),string.match(']-','[]-]+')",
  "return string.match(string.char(0,255,65),'%z%Z%u')",
  "return string.find('a','a*%f[a]')",
  "return string.match('abc','()%1')",
  "return string.find('a]b',']'),string.match('x$y','$')",
  "return ('a1b2'):match('%d+'),('a1b2'):find('b')"
])("preserves retained Lua pattern matching: %s",async source=>{expect(await execute(source,{string:true})).toEqual(native(source));});
it.each(["string.match('x','%')","string.match('x','[')","string.match('x','%f')","string.match('x','%b(')","string.match('x','%1')","string.match('x','(')","string.match('x',')')"])("reports malformed Lua patterns: %s",async source=>{await expect(execute(source,{string:true})).rejects.toMatchObject({code:"E_AST"});});

it.each([
  "return string.find('abc','()%1%1')",
  "return string.match('aa','^(a?)(a*)$'),string.match('aaab','(a*)ab')",
  "return string.match(' 09_f!','%s%d%d%p%l%p'),string.match('AZ','%u+'),string.match('xyz','%X+')",
  "return string.match('aabb','(a+)(b+)%1?'),string.match('abab','((ab)%2)')",
  "return select('#',string.match('',string.rep('()',32)))",
  "return string.find('xx.a','.',3,0),string.find('abc',')'),string.match('abc','abc',-99)"
])("preserves pattern backtracking and capture edges: %s",async source=>{expect(await execute(source,{string:true})).toEqual(native(source));});
it.each([
  "return string.match('',string.rep('()',33))",
  "return string.match(string.rep('a',200),string.rep('a?',200))"
])("retains existing pattern complexity limits: %s",async source=>{await expect(execute(source,{string:true})).rejects.toMatchObject({code:"E_AST"});});

it("matches retained input across cache boundaries with bounded reads",async()=>{
  const result=await execute("local s=host(); local a,b=string.find(s,'xyz',1,true); local c=string.match(s,'(x+y+)z'); return a,b,#c,string.sub(c,-3)",{string:true,native:async heap=>{
    const value=await heap.string([new TextEncoder().encode('x'.repeat(8191)+'xyz')]);
    const read=heap.readBytes.bind(heap);
    vi.spyOn(heap,"readBytes").mockImplementation(async(value,start,count)=>{expect(count).toBeLessThanOrEqual(8192);return read(value,start,count);});
    return [value];
  }});
  expect(result).toEqual([{kind:"integer",value:8192},{kind:"integer",value:8194},{kind:"integer",value:8193},"xxy"]);
});
it("cancels backtracking within resident pattern caches and cleans storage",async()=>{
  const controller=new AbortController();
  await expect(execute("return string.match(host(),'a*a*a*a*a*a*a*a*b')",{string:true,signal:controller.signal,native:async heap=>{
    const value=await heap.string([new TextEncoder().encode('a'.repeat(40))]),read=heap.readBytes.bind(heap);
    let scheduled=false;
    vi.spyOn(heap,"readBytes").mockImplementation(async(...args)=>{const result=await read(...args);if(!scheduled){scheduled=true;setTimeout(()=>controller.abort(),0);}return result;});
    return [value];
  }})).rejects.toMatchObject({code:"E_CANCELLED"});
});

it.each([
  "local out=''; for w in string.gmatch('one two 3','%w+') do out=out..w..':' end; return out",
  "local out=''; for p,w in string.gmatch('ab cd','()(%a+)') do out=out..p..w end; return out",
  "local out=''; for p in string.gmatch('abc','()') do out=out..p end; return out",
  "local out=''; for w in string.gmatch('aab','a*') do out=out..'['..w..']' end; return out",
  "local f=string.gmatch('^a^','^'); return f(),f(),f(),f()",
  "local a=string.gmatch('12','.' ); local b=string.gmatch('xy','.'); return a(),b(),a(),b(),a()",
  "local f=string.gmatch(123,2); return f(),f()",
  "local f=string.gmatch('a','('); return type(f)"
])("retains independent Lua pattern iterator state: %s",async source=>{expect(await execute(source,{string:true})).toEqual(native(source));});
it.each(["string.gmatch(false,'.')","string.gmatch('x',false)"])("validates pattern iterator arguments eagerly: %s",async source=>{await expect(execute(source,{string:true})).rejects.toMatchObject({code:"E_AST"});});

it.each([
  "return string.gsub('hello world','%w+','[%0]')",
  "return string.gsub('abc123 def456','(%a+)(%d+)','%2:%1:%%')",
  "return string.gsub('abc','()','%1')",
  "return string.gsub('aab','a*','X')",
  "return string.gsub('abc','^','X'),string.gsub('abc','$','X')",
  "return string.gsub('aaa','a','b',2),string.gsub('aaa','a','b',0),string.gsub('aaa','a','b',-1)",
  "return string.gsub('a b c','%a',{a='A',b=false,c=7})",
  "return string.gsub('a1 b2','(%a)(%d)',function(a,b) return b..a end)",
  "return string.gsub('abc','.',function(a) if a=='b' then return false end end)",
  "return string.gsub('aa','a',17)",
  "return string.gsub('ab','.',setmetatable({}, {__index=function(_,k) return k..k end}))",
  "return string.gsub('abc','b','%1')"
])("retains Lua pattern replacement semantics: %s",async source=>{expect(await execute(source,{string:true})).toEqual(native(source));});
it.each(["string.gsub('x','.',true)","string.gsub('x','.','%q')","string.gsub('x','.','%2')","string.gsub('x','.',function() return {} end)"])("reports pattern replacement errors: %s",async source=>{await expect(execute(source,{string:true})).rejects.toMatchObject({code:"E_AST"});});

it.each([
  "return string.gsub('ab','.',function(c) return string.gsub(c..c,c,'X') end)",
  "getmetatable('').__tostring=function(s) return '['..s..']' end; return string.gsub('ab','(.)','%1/%0')",
  "local r,n=string.gsub('abc','',':'); return r,n",
  "return string.gsub('abc','x','%q')",
  "return string.gsub('abc','^b','X')",
  "return string.gsub('abc','a',{},-1)"
])("preserves replacement callback and empty-match edges: %s",async source=>{expect(await execute(source,{string:true})).toEqual(native(source));});
it("streams replacement literals and captures across storage chunks",async()=>{
  const source="local s,r=host(); local out,n=string.gsub(s,'(a+)z',r); return #out,string.sub(out,8190,8196),string.sub(out,-4),n";
  const result=await execute(source,{string:true,native:async heap=>{
    const input=await heap.string([new TextEncoder().encode('a'.repeat(8193)+'z')]),replacement=await heap.string([new TextEncoder().encode('b'.repeat(8191)+'%1!')]);
    const read=heap.readBytes.bind(heap);
    vi.spyOn(heap,"readBytes").mockImplementation(async(value,start,count)=>{expect(count).toBeLessThanOrEqual(8192);return read(value,start,count);});
    return [input,replacement];
  }});
  expect(result).toEqual([{kind:"integer",value:16385},"bbaaaaa","aaa!",{kind:"integer",value:1}]);
});
it("cancels inside a replacement callback and cleans retained iterator state",async()=>{
  const controller=new AbortController();
  await expect(execute("return string.gsub('x','.',function() host(); while true do end end)",{string:true,signal:controller.signal,native:()=>{setTimeout(()=>controller.abort(),0);return [];}})).rejects.toMatchObject({code:"E_CANCELLED"});
});
