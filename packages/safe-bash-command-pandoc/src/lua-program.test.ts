import {expect, it, vi} from "vitest";
import {MemoryFileSystem} from "@poe-code/safe-fs/fs/memory";
import {PagedStorage} from "safe-bash-io-engine/storage";
import {ExecutionContext} from "./execution.js";
import {LuaStorage} from "./lua-storage.js";
import {LuaProgram} from "./lua-program.js";

async function usingProgram(run: (program: LuaProgram, heap: LuaStorage, fs: MemoryFileSystem) => Promise<void>, signal?: AbortSignal) {
  const fs = new MemoryFileSystem(), context = new ExecutionContext("convert", signal ? {signal} : {});
  const storage = new PagedStorage({fs, cwd: "/", env: {}, signal: signal ?? new AbortController().signal}, 1);
  const heap = new LuaStorage(storage, units => context.cooperate(units));
  const program = new LuaProgram(storage, heap, units => context.cooperate(units));
  try {await run(program, heap, fs);}
  finally {await storage.close(); await context.close();}
  expect(await fs.readdir("/")).toEqual([]);
}

it("retains independently growing function bodies and supports forward-jump patching after spill", async () => {
  await usingProgram(async (program, _heap, fs) => {
    vi.spyOn(fs, "readFile").mockRejectedValue(new Error("Whole payload forbidden"));
    const open = vi.spyOn(fs, "open");
    const first = await program.create({parameters: 1, vararg: false, registers: 4});
    const second = await program.create({parameters: 2, vararg: true, registers: 8});
    for (let i = 0; i < 700; i++) {
      expect(await program.emit(first, (i * 65537) >>> 0, i + 1)).toBe(i);
      await program.emit(second, (0xffffffff - i) >>> 0, 1000 + i);
    }
    await program.patch(first, 0, 0xffffffff);
    expect(await program.instruction(first, 0)).toEqual({code: 0xffffffff, line: 1});
    expect(await program.instruction(first, 699)).toEqual({code: 699 * 65537, line: 700});
    expect(await program.instruction(second, 699)).toEqual({code: 0xffffffff - 699, line: 1699});
    expect(await program.describe(first)).toMatchObject({parameters: 1, vararg: false, registers: 4, instructions: 700});
    expect(await program.describe(second)).toMatchObject({parameters: 2, vararg: true, registers: 8, instructions: 700});
    await expect(program.instruction(first, 700)).rejects.toThrow("instruction index");
    await expect(program.patch(first, -1, 0)).rejects.toThrow("instruction index");
    expect(open).toHaveBeenCalled();
  });
});

it("preserves nil and tagged numeric constants and retained binary source names", async () => {
  await usingProgram(async (program, heap) => {
    const source = await heap.string([Uint8Array.of(255, 0, 65)]);
    const prototype = await program.create({parameters: 0, vararg: true, registers: 2, source});
    const text = await heap.string([new TextEncoder().encode("long ".repeat(6000))]);
    for (const value of [undefined, false, {kind: "integer" as const, value: 7}, 7, -0, text]) await program.addConstant(prototype, value);
    expect(await program.read(prototype, "constant", 0)).toBeUndefined();
    expect(await program.read(prototype, "constant", 1)).toBe(false);
    expect(await program.read(prototype, "constant", 2)).toEqual({kind: "integer", value: 7});
    expect(await program.read(prototype, "constant", 3)).toBe(7);
    expect(await program.read(prototype, "constant", 4)).toBe(-0);
    expect(await program.read(prototype, "constant", 5)).toEqual(text);
    expect(await program.describe(prototype)).toMatchObject({source, constants: 6});
    await expect(program.read(prototype, "constant", 6)).rejects.toThrow("constant index");
  });
});

it("retains nested prototypes and distinguishes register captures from parent upvalues", async () => {
  await usingProgram(async (program, heap) => {
    const parent = await program.create({parameters: 0, vararg: true, registers: 3});
    const child = await program.create({parameters: 1, vararg: false, registers: 2});
    expect(await program.addChild(parent, child)).toBe(0);
    expect(await program.read(parent, "child", 0)).toBe(child);
    await program.addCapture(child, {register: true, index: 2});
    await program.addCapture(child, {register: false, index: 0});
    expect(await program.capture(child, 0)).toEqual({register: true, index: 2});
    expect(await program.capture(child, 1)).toEqual({register: false, index: 0});
    expect(await program.describe(child)).toMatchObject({captures: 2});
    const closure = await heap.closure(child, [await heap.cell(42), await heap.cell(false)]);
    expect(await heap.prototype(closure)).toBe(await program.read(parent, "child", 0));
    await expect(program.capture(child, 2)).rejects.toThrow("capture index");
    await expect(program.read(parent, "child", 1)).rejects.toThrow("child index");
  });
});


it("cancels bytecode construction at a cooperative checkpoint and closes backing files", async () => {
  const controller = new AbortController();
  await usingProgram(async program => {
    const prototype = await program.create({parameters: 0, vararg: false, registers: 2});
    const timer = setTimeout(() => controller.abort(), 0);
    try {
      await expect((async () => {
        for (let i = 0; i < 10000; i++) await program.emit(prototype, 0, i);
      })()).rejects.toMatchObject({code: "E_CANCELLED"});
    } finally {clearTimeout(timer);}
  }, controller.signal);
});
