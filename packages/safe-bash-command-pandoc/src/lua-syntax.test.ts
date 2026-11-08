import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {luaAst} from "./lua-ast.js";
import runtime from "./fengari.generated.js";
import {ExecutionContext} from "./execution.js";
import {LuaStorage, type LuaReference} from "./lua-storage.js";
import {LuaLexer} from "./lua-lexer.js";
import {LuaSyntax} from "./lua-syntax.js";
import {LuaParser} from "./lua-parser.js";

const encoder = new TextEncoder();
async function parse(source: string | AsyncIterable<Uint8Array>, inspect: (root: LuaReference, syntax: LuaSyntax, heap: LuaStorage) => Promise<void>, signal?: AbortSignal) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", signal ? {signal} : {});
  const storage = new PagedStorage({fs, cwd:"/",env:{},signal:signal ?? new AbortController().signal},1);
  const heap = new LuaStorage(storage, units => context.cooperate(units)), syntax = new LuaSyntax(heap);
  const chunks = typeof source === "string" ? (async function* () {for (const byte of encoder.encode(source)) yield Uint8Array.of(byte);})() : source;
  const lexer = new LuaLexer(chunks, heap, units => context.cooperate(units));
  try {await inspect(await new LuaParser(lexer, syntax).parse(), syntax, heap);}
  finally {await lexer.close(); await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
}
function nativeAccepts(source: string): boolean {
  const compiler = runtime as typeof import("fengari"), state = compiler.lauxlib.luaL_newstate(), input = encoder.encode(source);
  try {return compiler.lauxlib.luaL_loadbuffer(state,input,input.length,encoder.encode("fixture")) === compiler.lua.LUA_OK;}
  finally {compiler.lua.lua_close(state);}
}

const programs = [
  "local a,b,c=1,2; a,b=b,a; return a,b,c",
  "local function f(a,...) return a,... end; function a.b:c(x) return self,x end",
  "do local x=1 end; while true do break end; repeat local x=1 until x==1",
  "if a then x=1 elseif b then x=2 else x=3 end",
  "for i=1,10,2 do f(i) end; for k,v in pairs(t) do t[k]=v end",
  "::again:: x=x+1; if x<3 then goto again end; return x",
  "local t={1,2; x=3,[f()]=4,5,}; f{a=2}; f'hello'; t:m(1,f())",
  "return function(x) return function(y) return x+y end end",
  "return (f)(x).a[y]:method{...},not a and -b^2 or ~c,1<<2&3|4~5,1//2%3",
  "local a; a = ((f())).x; return a",
  "return -2^3^2 .. 'x' .. 'y' and a or b"
];
it.each(programs)("reads supported Lua syntax into caller-backed nodes: %s", async source => {
  expect(nativeAccepts(source)).toBe(true);
  await parse(source, async (root, syntax) => {
    expect((await syntax.describe(root)).kind).toBe("list");
    expect(await syntax.length(root)).toBeGreaterThan(0);
  });
});

it("preserves assignment targets without evaluating them and groups comparison precedence", async () => {
  await parse("a.b[f()],c = x<y and z or q, 2", async (root, syntax) => {
    const assignment = await syntax.at(root,0) as LuaReference;
    expect((await syntax.describe(assignment)).kind).toBe("assign");
    const targets = await syntax.get(assignment,"variables") as LuaReference;
    expect(await syntax.length(targets)).toBe(2);
    expect((await syntax.describe(await syntax.at(targets,0) as LuaReference)).kind).toBe("index");
    const values = await syntax.get(assignment,"values") as LuaReference;
    const logical = await syntax.at(values,0) as LuaReference;
    expect(await syntax.operator(logical)).toBe("or");
    const and = await syntax.get(logical,"left") as LuaReference;
    expect(await syntax.operator(and)).toBe("and");
    expect(await syntax.operator(await syntax.get(and,"left") as LuaReference)).toBe("<");
  });
});

it.each(["local = 1", "if true x=1 end", "while a x=1 end", "repeat x=1 end", "for i=1 do end", "function f(a,) end",
  "f(1,)", "local t={a=}", "a+1", "f()=1", "return 1; x=2", "if a then", "a=", "::x", "do else end"])
("rejects malformed grammar accepted by neither parser: %s", async source => {
  expect(nativeAccepts(source)).toBe(false);
  await expect(parse(source, async () => {})).rejects.toMatchObject({code:"E_AST"});
});

it("retains wide statement sequences without a resident statement array", async () => {
  const count=128, statement=encoder.encode("x=x+1;\n");
  await parse((async function* () {for(let i=0;i<count;i++) yield statement;})(), async (root, syntax) => {
    expect(await syntax.length(root)).toBe(count);
    const last=await syntax.at(root,count-1) as LuaReference;
    expect(await syntax.describe(last)).toEqual({kind:"assign",line:count});
  });
});


it.each([190,198,199,200])("matches the existing expression nesting boundary at %s levels", async count => {
  const source="return "+"(".repeat(count)+"1"+")".repeat(count), accepted=nativeAccepts(source);
  if (accepted) await parse(source,async () => {});
  else await expect(parse(source,async () => {})).rejects.toMatchObject({code:"E_AST"});
});

it("preserves right-associative exponentiation and concatenation around unary minus", async () => {
  await parse("return -2^3^2 .. 'a' .. 'b'",async (root,syntax) => {
    const ret=await syntax.at(root,0) as LuaReference, values=await syntax.get(ret,"values") as LuaReference;
    const concat=await syntax.at(values,0) as LuaReference;
    expect(await syntax.operator(concat)).toBe("..");
    const unary=await syntax.get(concat,"left") as LuaReference;
    expect(await syntax.operator(unary)).toBe("-");
    const power=await syntax.get(unary,"operand") as LuaReference;
    expect(await syntax.operator(power)).toBe("^");
    expect(await syntax.operator(await syntax.get(power,"right") as LuaReference)).toBe("^");
    expect(await syntax.operator(await syntax.get(concat,"right") as LuaReference)).toBe("..");
  });
});

it("closes the producer and backing storage after cancellation during parsing", async () => {
  const controller=new AbortController(); let closed=false;
  const source=(async function* () {try {yield encoder.encode("do "); controller.abort(); yield encoder.encode("end");} finally {closed=true;}})();
  await expect(parse(source,async () => {},controller.signal)).rejects.toMatchObject({code:"E_CANCELLED"});
  expect(closed).toBe(true);
});


it("parses the shipped Pandoc constructors and traversal bootstrap", async () => {
  expect(nativeAccepts(luaAst)).toBe(true);
  await parse(luaAst,async (root,syntax) => {
    expect(await syntax.length(root)).toBeGreaterThan(10);
    expect((await syntax.describe(await syntax.at(root,0) as LuaReference)).kind).toBe("local");
  });
});
