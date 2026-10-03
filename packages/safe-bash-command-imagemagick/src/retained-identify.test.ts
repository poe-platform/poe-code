import { expect, it } from "vitest";
import sharp from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { runIdentifyCli, createIdentifyCommand, createMagickCommand } from "./index.js";
for (const format of ["png", "jpeg", "webp", "tiff", "gif", "bmp", "ppm", "heif", "pdf"] as const)
    for (const verbose of [false, true])
        it(`inspects ${format}, verbose=${verbose} through retained caller input`, async () => {
            const bytes = await sharp({ create: { width: 17, height: 11, channels: 4, background: "red" } }).toFormat(format).toBuffer(), fs = new MemoryFileSystem();
            await fs.writeFile("/input", bytes);
            const filesystem = new Proxy(fs, { get(target, key) { if (key === "readFile" || key === "writeFile")
                    return () => { throw new Error("whole-file identify I/O forbidden"); }; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
            const args = [...(verbose ? ["-verbose"] : []), "input"], expected = await runIdentifyCli(args, new Map([["input", bytes]]));
            expect(await runIdentifyCli(args, { filesystem, cwd: "/" })).toEqual(expected);
            expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input"]);
        });
for (const magick of [false, true])
    it(`routes the ${magick ? "magick identify" : "identify"} command through retained input`, async () => {
        const bytes = await sharp({ create: { width: 17, height: 11, channels: 4, background: "red" } }).png().toBuffer(), fs = new MemoryFileSystem();
        await fs.writeFile("/input", bytes);
        const filesystem = new Proxy(fs, { get(target, key) { if (key === "readFile")
                return () => { throw new Error("whole-file identify I/O forbidden"); }; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } });
        const command = magick ? createMagickCommand() : createIdentifyCommand(), args = createCommandArguments([...(magick ? ["identify"] : []), "input"]);
        let stdout = "", stderr = "";
        const result = await command.execute({ command: command.name, args: args.args, argumentValues: args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () { })(), stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } } });
        expect({ ...result, stdout, stderr }).toEqual(await runIdentifyCli(["input"], new Map([["input", bytes]])));
    });
it("retains chunked stdin once for repeated identify operands and cleans backing", async () => {
    const bytes = await sharp({ create: { width: 1025, height: 513, channels: 4, background: "red" } }).toFormat("bmp").toBuffer(), fs = new MemoryFileSystem();
    let opened = 0, closed = 0, charged = 0, pulls = 0;
    const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "readFile" || key === "writeFile")
                return () => { throw new Error("whole-file identify I/O forbidden"); };
            if (key === "open")
                return async (...args: Parameters<typeof fs.open>) => { const handle = await fs.open(...args); opened++; return new Proxy(handle, { get(target, key) { if (key === "close")
                        return async () => { closed++; await handle.close(); }; const value = Reflect.get(target, key, target); return typeof value === "function" ? value.bind(target) : value; } }); };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
    const stdin = (async function* () { for (let offset = 0; offset < bytes.length; offset += 16384) {
        pulls++;
        yield bytes.subarray(offset, offset + 16384);
    } })();
    expect(await runIdentifyCli(["-", "-"], { filesystem, cwd: "/", stdin, inputBudget: { check(size) { charged = size; } } })).toEqual(await runIdentifyCli(["-", "-"], new Map(), bytes));
    expect(charged).toBe(bytes.length);
    expect(pulls).toBe(Math.ceil(bytes.length / 16384));
    expect(opened).toBeGreaterThan(0);
    expect(closed).toBe(opened);
    expect(await fs.readdir("/")).toEqual([]);
});
it("rejects identify input budgets before the first retained read", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", new Uint8Array(100));
    let reads = 0, closed = 0;
    const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "openReadFile")
                return async (...args: Parameters<typeof fs.openReadFile>) => { const handle = await fs.openReadFile(...args); return { stat: handle.stat.bind(handle), async read() { reads++; throw new Error("read before admission"); }, async close() { closed++; await handle.close(); } }; };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
    const args = createCommandArguments(["input"]);
    await expect(createIdentifyCommand({ limits: { maxInputBytes: 99 } }).execute({ command: "identify", args: args.args, cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal, stdin: (async function* () { })(), stdout: { async write() { } }, stderr: { async write() { } } })).rejects.toThrow("input byte limit");
    expect(reads).toBe(0);
    expect(closed).toBe(1);
});
for (const format of ["%m %wx%h %[opaque]", "%[fx:mean] %[standard-deviation]", "%[hex:p{0,0}] %[pixel:p{0,0}]", "%% %f %b"])
    it(`preserves custom formatting ${format}`, async () => {
        const bytes = await sharp({ create: { width: 3, height: 2, channels: 4, background: "red" } }).png().toBuffer(), fs = new MemoryFileSystem();
        await fs.writeFile("/input", bytes);
        const args = ["-format", format, "png:input[0]"];
        expect(await runIdentifyCli(args, { filesystem: fs, cwd: "/" })).toEqual(await runIdentifyCli(args, new Map([["input", bytes]])));
    });
for (const bytes of [new Uint8Array(), new Uint8Array([73, 73, 42, 0, 8, 0, 0, 0]), new TextEncoder().encode("not an image")])
    it(`preserves malformed diagnostics for ${bytes.length} bytes`, async () => {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/input", bytes);
        expect(await runIdentifyCli(["input", "missing"], { filesystem: fs, cwd: "/" })).toEqual(await runIdentifyCli(["input", "missing"], new Map([["input", bytes]])));
    });
it("preserves retained read failures and closes the source", async () => {
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input", new Uint8Array(100));
    const failure = { reason: "remote read failed" };
    let closed = 0;
    const filesystem = new Proxy(fs, { get(target, key) {
            if (key === "openReadFile")
                return async (...args: Parameters<typeof fs.openReadFile>) => { const handle = await fs.openReadFile(...args); return { stat: handle.stat.bind(handle), async read() { throw failure; }, async close() { closed++; await handle.close(); } }; };
            const value = Reflect.get(target, key, target);
            return typeof value === "function" ? value.bind(target) : value;
        } });
    await expect(runIdentifyCli(["input"], { filesystem, cwd: "/" })).rejects.toBe(failure);
    expect(closed).toBe(1);
});
it("cancels retained stdin and removes scratch before rejecting", async () => {
    const fs = new MemoryFileSystem(), controller = new AbortController(), failure = new Error("stop stdin");
    let returned = false;
    const stdin = (async function* () { try {
        for (let i = 0; i < 100; i++) {
            if (i === 80)
                controller.abort(failure);
            yield new Uint8Array(16384);
        }
    }
    finally {
        returned = true;
    } })();
    await expect(runIdentifyCli(["-"], { filesystem: fs, cwd: "/", stdin }, undefined, controller.signal)).rejects.toBe(failure);
    expect(returned).toBe(true);
    expect(await fs.readdir("/")).toEqual([]);
});

it("decodes verbose statistics from retained multi-page stdin reads",async()=>{
 const bytes=await sharp({create:{width:601,height:601,channels:4,background:"red"}}).bmp().toBuffer(),fs=new MemoryFileSystem();
 const stdin=(async function*(){for(let position=0;position<bytes.length;position+=16384)yield bytes.subarray(position,position+16384);})();
 expect(await runIdentifyCli(["-verbose","-"],{filesystem:fs,cwd:"/",stdin})).toEqual(await runIdentifyCli(["-verbose","-"],new Map(),bytes));
 expect(await fs.readdir("/")).toEqual([]);
});
