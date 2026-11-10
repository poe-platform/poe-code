import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["2foo", "2-0", "2;0", "2+0", "2", "2,0"])(`validates the entire duplicate count %s: ${mode}`, async count => {
        for (const existing of [false, true]) {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const run = (args: string[]) => mode === "sync" ? runConvertCliSync(args, files)
                : runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            if (existing) expect((await run(["-size", "1x1", "xc:black", "PNG24:out.png"])).exitCode).toBe(0);
            const result = await run(["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "xc:white", "-duplicate", count, "+append", "PNG24:out.png"]);
            const valid = count === "2" || count === "2,0";
            expect(result.exitCode).toBe(valid ? 0 : 1);
            if (!valid && !existing) {
                if (mode === "retained") await expect(filesystem.readFile("/out.png")).rejects.toThrow();
                else expect(files.has("out.png")).toBe(false);
                continue;
            }
            const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255], white = [255, 255, 255, 255];
            const repeated = count === "2" ? white : red;
            expect([image.width, image.height]).toEqual([valid ? 6 : 1, 1]);
            expect([...image.data]).toEqual(valid ? [red, green, blue, white, repeated, repeated].flat() : [0, 0, 0, 255]);
        }
    });
    for (const count of ["-1", "-2,0", "0", "2"]) {
        it(`preserves frame order for duplicate count ${count}: ${mode}`, async () => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", "xc:red", "xc:lime", "xc:blue", "-duplicate", count, "+append", "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0, stderr: "" });
            const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];
            expect([image.width, image.height]).toEqual([count === "2" ? 5 : 3, 1]);
            expect([...image.data]).toEqual((count === "2" ? [red, green, blue, blue, blue] : [red, green, blue]).flat());
        });
    }
    for (const operation of [["+duplicate"], ["-duplicate", "1,0"]]) {
        it(`rejects duplication from an empty current list: ${mode} ${operation}`, async () => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", "xc:red", "xc:lime", "(", ...operation, ")", "+append", "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain(`no images found for operation ${operation[0]}`);
            expect(files.has("out.png")).toBe(false);
            expect(await filesystem.readdir("/")).toEqual([]);
        });
    }
    for (const nested of [["xc:blue", "+duplicate"], ["xc:blue", "-duplicate", "1,0"], ["+clone"]]) {
        it(`preserves nested stack pixels: ${mode} ${nested}`, async () => {
            const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", "xc:red", "xc:lime", "(", ...nested, ")", "+append", "out.png"];
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
            const red = [255, 0, 0, 255], green = [0, 255, 0, 255], blue = [0, 0, 255, 255];
            expect([...image.data]).toEqual((nested[0] === "+clone" ? [red, green, green] : [red, green, blue, blue]).flat());
        });
    }
}
