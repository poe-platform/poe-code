import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {LuaStorage} from "./lua-storage.js";
import {LuaProgram} from "./lua-program.js";
import runtime from "./fengari.generated.js";
import {LuaJumps} from "./lua-jumps.js";

async function usingJumps(run: (jumps: LuaJumps, program: LuaProgram, heap: LuaStorage, prototype: number) => Promise<void>) {
  const fs=new MemoryFileSystem(), context=new ExecutionContext("convert",{});
  const storage=new PagedStorage({fs,cwd:"/",env:{},signal:new AbortController().signal},1);
  const heap=new LuaStorage(storage,units => context.cooperate(units));
  const program=new LuaProgram(storage,heap,units => context.cooperate(units));
  const prototype=await program.create({parameters:0,vararg:true,registers:2});
  try {await run(new LuaJumps(heap,program,prototype),program,heap,prototype);}
  finally {await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
}
const placeholder=30 | 131071<<14;
function decoded(code: number) {return {close:(code>>>6)&255,offset:(code>>>14)-131071};}

function nativeJump(source: string): {close: number; offset: number} {
  const compiler=runtime as typeof import("fengari"), state=compiler.lauxlib.luaL_newstate(), bytes=new TextEncoder().encode(source);
  try {
    expect(compiler.lauxlib.luaL_loadbuffer(state,bytes,bytes.length,new TextEncoder().encode("fixture"))).toBe(compiler.lua.LUA_OK);
    const internal=state as unknown as {top: number; stack: {value: {p: {code: {code: number}[]}}}[]};
    const code=internal.stack[internal.top-1]!.value.p.code.find(instruction => (instruction.code&63) === 30)!.code;
    return decoded(code);
  } finally {compiler.lua.lua_close(state);}
}

it("patches all pending forward jumps and resolves backward jumps", async () => {
  await usingJumps(async (jumps,program,heap,p) => {
    const root=await jumps.enterBlock(0), name=await heap.string([new TextEncoder().encode("again")]);
    for(let i=0;i<3;i++) {await program.emit(p,placeholder,1); await jumps.go(root,name,i,0);}
    await jumps.label(root,name,3,0);
    for(let i=0;i<3;i++) expect(decoded((await program.instruction(p,i)).code)).toEqual({close:0,offset:2-i});
    await program.emit(p,placeholder,1); await jumps.go(root,name,3,0);
    expect(decoded((await program.instruction(p,3)).code)).toEqual({close:0,offset:-1});
    await jumps.leaveBlock(root);
  });
});

it("allows a later inner label to shadow an already defined outer label", async () => {
  expect(nativeJump("::same:: do goto same; ::same:: end")).toEqual({close:0,offset:0});
  await usingJumps(async (jumps,program,heap,p) => {
    const root=await jumps.enterBlock(0), name=await heap.string([new TextEncoder().encode("same")]);
    await jumps.label(root,name,0,0);
    const block=await jumps.enterBlock(0,root);
    await program.emit(p,placeholder,1); await jumps.go(block,name,0,0);
    await jumps.label(block,name,1,0);
    expect(decoded((await program.instruction(p,0)).code)).toEqual({close:0,offset:0});
    await jumps.leaveBlock(block); await jumps.leaveBlock(root);
  });
});

it("moves unresolved jumps outward and closes registers from every exited block", async () => {
  await usingJumps(async (jumps,program,heap,p) => {
    const root=await jumps.enterBlock(0), name=await heap.string([new TextEncoder().encode("exit")]);
    await jumps.label(root,name,0,1);
    const outer=await jumps.enterBlock(1,root), inner=await jumps.enterBlock(2,outer);
    await program.emit(p,placeholder,1); await jumps.go(inner,name,0,3);
    await jumps.leaveBlock(inner); await jumps.leaveBlock(outer);
    expect(decoded((await program.instruction(p,0)).code)).toEqual({close:2,offset:-1});
    await jumps.leaveBlock(root);
  });
});

it("closes locals crossed by backward jumps in the same block", async () => {
  await usingJumps(async (jumps,program,heap,p) => {
    const root=await jumps.enterBlock(0), name=await heap.string([new TextEncoder().encode("repeat")]);
    await jumps.label(root,name,0,1);
    await program.emit(p,placeholder,1); await jumps.go(root,name,0,3);
    expect(decoded((await program.instruction(p,0)).code)).toEqual({close:2,offset:-1});
    await jumps.leaveBlock(root);
  });
});

it.each(["forward","outer"])("rejects a %s jump into a local variable's scope", async direction => {
  await usingJumps(async (jumps,program,heap,p) => {
    const root=await jumps.enterBlock(0), name=await heap.string([new TextEncoder().encode("bad")]);
    const block=direction === "outer" ? await jumps.enterBlock(0,root) : root;
    await program.emit(p,placeholder,1); await jumps.go(block,name,0,0);
    if(direction === "outer") await jumps.leaveBlock(block);
    await expect(jumps.label(root,name,1,1)).rejects.toMatchObject({code:"E_AST"});
  });
});

it("rejects duplicate labels and labels outside the function", async () => {
  await usingJumps(async (jumps,program,heap,p) => {
    const root=await jumps.enterBlock(0), name=await heap.string([new TextEncoder().encode("label")]);
    await jumps.label(root,name,0,0);
    await expect(jumps.label(root,name,0,0)).rejects.toMatchObject({code:"E_AST"});
    const separateFunction=await jumps.enterBlock(0);
    await program.emit(p,placeholder,1); await jumps.go(separateFunction,name,0,0);
    await expect(jumps.leaveBlock(separateFunction)).rejects.toMatchObject({code:"E_AST"});
  });
});

it("retains wide pending jump lists in caller storage", async () => {
  await usingJumps(async (jumps,program,heap,p) => {
    const root=await jumps.enterBlock(0), name=await heap.string([new TextEncoder().encode("finish")]);
    for(let i=0;i<128;i++) {await program.emit(p,placeholder,1); await jumps.go(root,name,i,0);}
    await jumps.label(root,name,128,0);
    expect(decoded((await program.instruction(p,0)).code)).toEqual({close:0,offset:127});
    expect(decoded((await program.instruction(p,127)).code)).toEqual({close:0,offset:0});
    await jumps.leaveBlock(root);
  });
});


it("preserves Lua jump-range limits and source lines", async () => {
  await usingJumps(async (jumps,program,_heap,p) => {
    await program.emit(p,placeholder,27);
    await jumps.patch(0,131072);
    expect(await program.instruction(p,0)).toEqual({code:(30 | 262142<<14)>>>0,line:27});
    await expect(jumps.patch(0,131073)).rejects.toMatchObject({code:"E_AST"});
    await expect(jumps.patch(0,-131071)).rejects.toMatchObject({code:"E_AST"});
  });
});
