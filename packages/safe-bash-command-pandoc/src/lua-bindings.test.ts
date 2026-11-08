import {expect, it} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {LuaStorage} from "./lua-storage.js";
import {LuaProgram} from "./lua-program.js";
import {LuaFrames} from "./lua-frames.js";
import {LuaMachine} from "./lua-machine.js";
import {LuaBindings} from "./lua-bindings.js";

async function usingBindings(run: (bindings: LuaBindings, program: LuaProgram, heap: LuaStorage, machine: LuaMachine) => Promise<void>) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", {});
  const storage = new PagedStorage({fs,cwd:"/",env:{},signal:new AbortController().signal},1);
  const heap = new LuaStorage(storage, units => context.cooperate(units));
  const program = new LuaProgram(storage,heap,units => context.cooperate(units));
  const frames=new LuaFrames(storage,heap,units => context.cooperate(units));
  const machine=new LuaMachine(program,frames,heap,units => context.cooperate(units));
  try {await run(new LuaBindings(heap,program),program,heap,machine);}
  finally {await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
}

it("resolves local shadowing and reuses registers only after leaving a block", async () => {
  await usingBindings(async (bindings,program,heap) => {
    const root=await bindings.enterFunction(await program.create({parameters:0,vararg:true,registers:2}));
    const name=await heap.string([new TextEncoder().encode("x")]);
    const first=await bindings.declare(root,name);
    expect(first).toMatchObject({register:true,index:0});
    const block=await bindings.enterBlock(root);
    expect(await bindings.resolve(block,name)).toEqual(first);
    const shadow=await bindings.declare(block,name);
    expect(shadow).toMatchObject({register:true,index:1});
    expect(await bindings.resolve(block,name)).toEqual(shadow);
    expect(await bindings.leaveBlock(block)).toEqual({parent:root,closeFrom:undefined});
    expect(await bindings.resolve(root,name)).toEqual(first);
    expect(await bindings.declare(root,name)).toMatchObject({register:true,index:1});
  });
});

it("threads shared captures through every intervening function without a resident recursion stack", async () => {
  await usingBindings(async (bindings,program,heap) => {
    const root=await bindings.enterFunction(await program.create({parameters:0,vararg:true,registers:2}));
    const block=await bindings.enterBlock(root), name=await heap.string([new TextEncoder().encode("captured")]);
    const local=await bindings.declare(block,name);
    const childPrototype=await program.create({parameters:0,vararg:false,registers:2});
    const child=await bindings.enterFunction(childPrototype,block);
    const grandPrototype=await program.create({parameters:0,vararg:false,registers:2});
    const grand=await bindings.enterFunction(grandPrototype,child);
    const capture=await bindings.resolve(grand,name);
    expect(capture).toEqual({...local,register:false,index:0});
    expect(await bindings.resolve(grand,name)).toEqual(capture);
    expect(await program.capture(childPrototype,0)).toEqual({register:true,index:0});
    expect(await program.capture(grandPrototype,0)).toEqual({register:false,index:0});
    expect(await program.describe(childPrototype)).toMatchObject({captures:1});
    expect(await program.describe(grandPrototype)).toMatchObject({captures:1});
    expect(await bindings.leaveBlock(block)).toEqual({parent:root,closeFrom:0});
  });
});

it("keeps environment captures lexical and leaves unresolved globals to the compiler", async () => {
  await usingBindings(async (bindings,program,heap) => {
    const root=await bindings.enterFunction(await program.create({parameters:0,vararg:true,registers:2}));
    const env=await heap.string([new TextEncoder().encode("_ENV")]);
    expect(await bindings.resolve(root,env)).toMatchObject({register:false,index:0});
    const missing=await heap.string([new TextEncoder().encode("unknown")]);
    expect(await bindings.resolve(root,missing)).toBeUndefined();
    const block=await bindings.enterBlock(root);
    const local=await bindings.declare(block,env);
    const prototype=await program.create({parameters:0,vararg:false,registers:2});
    const child=await bindings.enterFunction(prototype,block);
    expect(await bindings.resolve(child,env)).toEqual({...local,register:false,index:0});
    expect(await program.capture(prototype,0)).toEqual({register:true,index:0});
  });
});

it("distinguishes sequential same-name declarations when constructing captures", async () => {
  await usingBindings(async (bindings,program,heap) => {
    const root=await bindings.enterFunction(await program.create({parameters:0,vararg:true,registers:2}));
    const name=await heap.string([new TextEncoder().encode("x")]);
    const first=await bindings.declare(root,name);
    const p1=await program.create({parameters:0,vararg:false,registers:2});
    const c1=await bindings.enterFunction(p1,root);
    expect(await bindings.resolve(c1,name)).toEqual({...first,register:false,index:0});
    const second=await bindings.declare(root,name);
    const p2=await program.create({parameters:0,vararg:false,registers:2});
    const c2=await bindings.enterFunction(p2,root);
    expect(await bindings.resolve(c2,name)).toEqual({...second,register:false,index:0});
    expect(await program.capture(p1,0)).toEqual({register:true,index:0});
    expect(await program.capture(p2,0)).toEqual({register:true,index:1});
  });
});

it("preserves the existing 200 active local limit and releases block registers", async () => {
  await usingBindings(async (bindings,program,heap) => {
    const root=await bindings.enterFunction(await program.create({parameters:0,vararg:true,registers:2}));
    const name=await heap.string([new TextEncoder().encode("x")]), block=await bindings.enterBlock(root);
    for(let i=0;i<200;i++) expect(await bindings.declare(block,name)).toMatchObject({index:i});
    await expect(bindings.declare(block,name)).rejects.toMatchObject({code:"E_AST"});
    expect(await bindings.active(root)).toBe(200);
    await bindings.leaveBlock(block);
    expect(await bindings.declare(root,name)).toMatchObject({index:0});
  });
});

it("retains the lexical declaration snapshot when parent compilation continues", async () => {
  await usingBindings(async (bindings,program,heap) => {
    const root=await bindings.enterFunction(await program.create({parameters:0,vararg:true,registers:2}));
    const name=await heap.string([new TextEncoder().encode("x")]);
    const first=await bindings.declare(root,name), block=await bindings.enterBlock(root);
    const child=await bindings.enterFunction(await program.create({parameters:0,vararg:false,registers:2}),block);
    await bindings.declare(root,name);
    await bindings.declare(block,name);
    expect(await bindings.resolve(child,name)).toEqual({...first,register:false,index:0});
  });
});

it("enforces the existing upvalue limit across multiple enclosing functions without adding a partial capture", async () => {
  await usingBindings(async (bindings,program,heap) => {
    const root=await bindings.enterFunction(await program.create({parameters:0,vararg:true,registers:2}));
    const name=async (i: number) => heap.string([new TextEncoder().encode(`v${i}`)]);
    for(let i=0;i<180;i++) await bindings.declare(root,await name(i));
    const child=await bindings.enterFunction(await program.create({parameters:0,vararg:false,registers:2}),root);
    for(let i=180;i<256;i++) await bindings.declare(child,await name(i));
    const prototype=await program.create({parameters:0,vararg:false,registers:2});
    const grandchild=await bindings.enterFunction(prototype,child);
    for(let i=0;i<255;i++) expect(await bindings.resolve(grandchild,await name(i))).toMatchObject({register:false,index:i});
    await expect(bindings.resolve(grandchild,await name(255))).rejects.toMatchObject({code:"E_AST"});
    expect(await program.describe(prototype)).toMatchObject({captures:255});
  });
});


it("executes generated capture descriptors and closes captured cells before register reuse", async () => {
  await usingBindings(async (bindings,program,heap,machine) => {
    const prototype=await program.create({parameters:0,vararg:true,registers:2});
    const root=await bindings.enterFunction(prototype), block=await bindings.enterBlock(root);
    const name=await heap.string([new TextEncoder().encode("x")]);
    const local=await bindings.declare(block,name);
    const childPrototype=await program.create({parameters:0,vararg:false,registers:2});
    const child=await bindings.enterFunction(childPrototype,block), capture=await bindings.resolve(child,name);
    const abc=(opcode: number,a: number,b: number,c=0) => (opcode | a<<6 | c<<14 | b<<23) >>> 0;
    await program.emit(childPrototype,abc(5,0,capture!.index),1); // GETUPVAL
    await program.emit(childPrototype,abc(38,0,2),1); // RETURN one result
    await program.addChild(prototype,childPrototype);
    await program.addConstant(prototype,{kind:"integer",value:7});
    await program.addConstant(prototype,{kind:"integer",value:9});
    await program.emit(prototype,1 | local.index<<6,1); // LOADK x, 7
    await program.emit(prototype,44 | 1<<6,1); // CLOSURE R1, child 0
    const {closeFrom}=await bindings.leaveBlock(block);
    await program.emit(prototype,30 | (closeFrom!+1)<<6 | 131071<<14,1); // JMP close, +0
    const reused=await bindings.declare(root,name);
    await program.emit(prototype,1 | reused.index<<6 | 1<<14,1); // LOADK x, 9
    await program.emit(prototype,abc(36,1,1,2),1); // CALL R1, no args, one result
    await program.emit(prototype,abc(38,1,2),1);
    const environment=await heap.table(), closure=await heap.closure(prototype,[await heap.cell(environment)]);
    const result=await machine.run(closure,[]);
    expect(result.count).toBe(1);
    expect(await heap.get(result.values,0)).toEqual({kind:"integer",value:7});
  });
});
