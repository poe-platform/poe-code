import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { selector: "", colors: ["red", "lime", "blue"] },
        { selector: "[1]", colors: ["lime"] },
        { selector: "[2-0]", colors: ["blue", "lime", "red"] },
        { selector: "[-1]", colors: ["blue"] },
        { selector: "[2,0,2]", colors: ["blue", "red", "blue"] }
    ])(`selects MPR frames in ${mode}: $selector`, async ({ selector, colors }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:red", "xc:lime", "xc:blue", "-write", "mpr:Seq", "-delete", "0-2", `mpr:Seq${selector}`, "+append", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([image.width, image.height]).toEqual([colors.length, 1]);
        const pixels = { red: [255, 0, 0, 255], lime: [0, 255, 0, 255], blue: [0, 0, 255, 255] };
        expect([...image.data]).toEqual(colors.flatMap(color => pixels[color as keyof typeof pixels]));
    });

    it.each([
        { selector: "[1x1+1+0]", pixels: [0, 255, 0, 255] },
        { selector: "[4x1!]", pixels: [255, 0, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255, 0, 255, 0, 255] }
    ])(`applies MPR read geometry in ${mode}: $selector`, async ({ selector, pixels }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:red", "xc:lime", "+append", "-write", "mpr:Saved", "+delete", "-filter", "Point", `mpr:Saved${selector}`, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([image.width, image.height]).toEqual([pixels.length / 4, 1]);
        expect([...image.data]).toEqual(pixels);
    });

    it(`crops MPR reads without changing the saved image in ${mode}`, async () => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["xc:red", "xc:lime", "+append", "-write", "mpr:Saved", "+delete", "mpr:Saved[1x1+1+0]", "mpr:Saved", "+append", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stderr: "" });
        const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([image.width, image.height]).toEqual([3, 1]);
        expect([...image.data]).toEqual([0, 255, 0, 255, 255, 0, 0, 255, 0, 255, 0, 255]);
    });

    it.each([
        { operations: ["xc:lime", "+append", "-write", "mpr:Saved", "+delete", "mpr:sAvEd"], pixels: [255, 0, 0, 255, 0, 255, 0, 255] },
        { operations: ["-write", "mpr:Saved", "+delete", "xc:blue", "-write", "mpr:SAVED", "+delete", "mpr:Saved"], pixels: [0, 0, 255, 255] },
        { operations: ["(", "+clone", "+write", "MPR:Saved", "+delete", ")", "mpr:sAvEd", "+append"], pixels: [255, 0, 0, 255, 255, 0, 0, 255] },
        { operations: ["-write", "mpr:Saved", "+delete", "xc:blue", "+dither", "-remap", "mpr:sAvEd"], pixels: [255, 0, 0, 255] },
        { operations: ["-write", "mpr:orig", "-negate", "mpr:orig", "+append"], pixels: [0, 255, 255, 255, 255, 0, 0, 255] },
        { operations: ["-write", "mpr:orig", "-negate", "+write", "mpr:orig", "+delete", "mpr:orig"], pixels: [0, 255, 255, 255] },
        { operations: ["(", "+clone", "-write", "mpr:orig", "+delete", ")", "mpr:orig", "+append"], pixels: [255, 0, 0, 255, 255, 0, 0, 255] },
        { operations: ["xc:blue", "-write", "mpr:orig", "-delete", "0-1", "mpr:orig", "+append"], pixels: [255, 0, 0, 255, 0, 0, 255, 255] }
    ])(`keeps registers local and reusable in ${mode}: $operations`, async ({ operations, pixels }) => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const run = (args: string[]) => mode === "sync" ? runConvertCliSync(args, files)
            : runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect((await run(["-size", "1x1", "xc:red", ...operations, "out.png"])).exitCode).toBe(0);
        expect([...decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!).data]).toEqual(pixels);
        expect(mode === "retained" ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()]).toEqual(["out.png"]);
        expect((await run(["mpr:orig", "later.png"])).exitCode).toBe(1);
        expect((await run(["-size", "1x1", "xc:blue", "mpr:final"])).exitCode).toBe(0);
        expect(mode === "retained" ? (await filesystem.readdir("/")).map(entry => entry.name) : [...files.keys()]).toEqual(["out.png"]);
    });
}
