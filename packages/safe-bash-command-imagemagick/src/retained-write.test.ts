import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli } from "./index.js";

const operations = [
    ["-write", "middle.png", "-negate"],
    ["+write", "middle.jpg", "-flip", "-write", "middle.jpg"],
    ["-write", "input", "-gamma", "1.4"],
    ["-write", "palette.png", "-negate", "-remap", "palette.png"],
    ["-write", "middle.png", "-write", "middle.png"],
    ["-write", "null:", "-flip"],
    ["-write", "middle.png", "-remap", "broken"],
    ["-write", "png:-", "-negate"],
    ["-quality", "40", "-write", "palette.jpg", "-remap", "palette.jpg"],
    ["-write", "palette.gif", "-remap", "palette.gif"]
];
async function fixture() {
    return sharp(Uint8Array.from({ length: 1031 * 3 * 4 }, (_, i) => i * 37 % 256), { raw: { width: 1031, height: 3, channels: 4 } }).png().toBuffer();
}
it.each(operations.map(args => ({ args })))("retains intermediate writes $args", async ({ args }) => {
    const bytes = await fixture(), fs = new MemoryFileSystem(), files = new Map([["input", bytes], ["broken", new Uint8Array([1, 2, 3])]]);
    for (const [path, bytes] of files) await fs.writeFile("/" + path, bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file intermediate I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", ...args, "out.png"];
    const expected = await runConvertCli(argv, files);
    expect(await runConvertCli(argv, { filesystem, cwd: "/" })).toEqual(expected);
    for (const [path, bytes] of files) if (path !== "broken") {
        expect(decodeImage(await fs.readFile("/" + path))).toEqual(decodeImage(bytes));
    }
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual([...files.keys()].sort());
});
it("defers intermediate publication until later input reads have finished", async () => {
    const bytes = await fixture(), fs = new MemoryFileSystem();
    await fs.writeFile("/input", bytes); await fs.writeFile("/palette", bytes);
    let paletteRead = false, published = 0;
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file intermediate I/O forbidden"); };
        if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
            if (args[0] === "/palette") { expect(published).toBe(0); paletteRead = true; }
            return fs.openReadFile(...args);
        };
        if (key === "publishStagedFile") return async (...args: Parameters<typeof fs.publishStagedFile>) => {
            expect(paletteRead).toBe(true); published++;
            return fs.publishStagedFile(...args);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    expect((await runConvertCli(["input", "-write", "middle.png", "-remap", "palette", "out.png"], { filesystem, cwd: "/" })).exitCode).toBe(0);
    expect(published).toBe(2);
});
it("discards pending intermediate snapshots when a later read is cancelled", async () => {
    const bytes = await fixture(), fs = new MemoryFileSystem(), controller = new AbortController(), reason = new Error("cancel after intermediate encoding");
    await fs.writeFile("/input", bytes); await fs.writeFile("/palette", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file intermediate I/O forbidden"); };
        if (key === "openReadFile") return async (...args: Parameters<NonNullable<typeof fs.openReadFile>>) => {
            if (args[0] === "/palette") { controller.abort(reason); throw reason; }
            return fs.openReadFile(...args);
        };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    await expect(runConvertCli(["input", "-write", "middle.png", "-remap", "palette", "out.png"], { filesystem, cwd: "/" }, undefined, controller.signal)).rejects.toBe(reason);
    expect((await fs.readdir("/")).map(entry => entry.name).sort()).toEqual(["input", "palette"]);
    expect(await fs.readFile("/input")).toEqual(bytes);
});
it("keeps stdin distinct from a literal dash intermediate output", async () => {
    const bytes = await fixture(), stdin = await sharp({ create: { width: 1, height: 1, channels: 4, background: "red" } }).png().toBuffer();
    const fs = new MemoryFileSystem(), files = new Map([["input", bytes]]);
    await fs.writeFile("/input", bytes);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file intermediate I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    const argv = ["input", "-write", "png:-", "-remap", "-", "out.png"];
    expect(await runConvertCli(argv, { filesystem, cwd: "/" }, stdin)).toEqual(await runConvertCli(argv, files, stdin));
    expect(decodeImage(await fs.readFile("/out.png"))).toEqual(decodeImage(files.get("out.png")!));
    expect(decodeImage(await fs.readFile("/-"))).toEqual(decodeImage(files.get("-")!));
});
