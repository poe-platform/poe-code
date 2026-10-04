import { expect, it } from "vitest";
import sharp, { decodeImage, readImageMetadata } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const pipelines = [
    ["animated.gif", "-coalesce", "-delay", "15", "-loop", "0", "-dispose", "previous", "-deconstruct", "out.gif"],
    ["first", "second", "out.gif"],
    ["animated.gif", "-reverse", "out.gif"],
    ["first", "-duplicate", "40", "-delete", "1-39", "out.gif"],
    ["first", "second", "frame-%02d.png"],
    ["first", "second", "+adjoin", "out.png"],
    ["animated.gif", "+adjoin", "out.gif"],
    ["first", "second", "+adjoin", "-write", "middle.png", "-adjoin", "out.png"],
    ["first", "(", "second", "+adjoin", ")", "out.gif"],
    ["first", "out.gif"]
];
it.each(pipelines.map(args => ({ args })))("retains output $args", async ({ args }) => {
    const fs = new MemoryFileSystem(), files = new Map<string, Uint8Array>();
    for (const [name, width, height] of [["first", 13, 17], ["second", 7, 11]] as const) {
        files.set(name, await sharp(Uint8Array.from({ length: width * height * 4 }, (_, i) => i * 37 % 256), { raw: { width, height, channels: 4 } }).png().toBuffer());
    }
    expect((await runConvertCli(["-size", "7x5", "xc:red", "xc:blue", "animated.gif"], files)).exitCode).toBe(0);
    for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file output I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const expected = await runConvertCli(args, files);
    expect(expected.exitCode).toBe(0);
    expect(await runConvertCli(args, { filesystem, cwd: "/" })).toEqual(expected);
    for (const [path, bytes] of files) {
        const actual = await fs.readFile("/" + path), metadata = readImageMetadata(bytes);
        expect({ ...readImageMetadata(actual), size: 0 }).toEqual({ ...metadata, size: 0 });
        for (let page = 0; page < (metadata.pages ?? 1); page++) expect(decodeImage(actual, { page })).toEqual(decodeImage(bytes, { page }));
    }
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual([...files.keys()].sort());
});

it.each([false, true])("streams animated output with backpressure and cancellation=%s", async abort => {
    const fs = new MemoryFileSystem(), controller = new AbortController(), reason = new Error("cancel animated output");
    const pixels = Uint8Array.from({ length: 1003 * 97 * 4 }, (_, index) => index * 37 % 256);
    const bytes = await sharp(pixels, { raw: { width: 1003, height: 97, channels: 4 } }).png().toBuffer();
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file animated I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    let started!: () => void, release!: () => void;
    const first = new Promise<void>(resolve => { started = resolve; }), gate = new Promise<void>(resolve => { release = resolve; });
    const chunks: Uint8Array[] = [];
    const run = runConvertCli(["input", "+clone", "-flop", "gif:-"], { filesystem, cwd: "/", stdout: { async write(chunk) {
        expect(chunk.length).toBeLessThanOrEqual(65536);
        chunks.push(new Uint8Array(chunk));
        if (chunks.length === 1) { started(); await gate; }
    } } }, undefined, controller.signal);
    await Promise.race([first, run.then(() => { throw new Error("No animated output was streamed"); })]);
    expect(chunks).toHaveLength(1);
    if (abort) controller.abort(reason);
    release();
    if (abort) {
        await expect(run).rejects.toBe(reason);
        expect(chunks).toHaveLength(1);
    } else {
        expect(await run).toEqual({ exitCode: 0, stdout: "", stderr: "" });
        const actual = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.length, 0));
        let offset = 0; for (const chunk of chunks) { actual.set(chunk, offset); offset += chunk.length; }
        expect(actual.length).toBeGreaterThan(65536);
        const files = new Map([["input", bytes]]);
        expect((await runConvertCli(["input", "+clone", "-flop", "out.gif"], files)).exitCode).toBe(0);
        for (let page = 0; page < 2; page++) expect(decodeImage(actual, { page })).toEqual(decodeImage(files.get("out.gif")!, { page }));
    }
    expect((await fs.readdir("/")).map(entry => entry.name)).toEqual(["input"]);
});
