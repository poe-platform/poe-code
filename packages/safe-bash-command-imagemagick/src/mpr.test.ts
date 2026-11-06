import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
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
