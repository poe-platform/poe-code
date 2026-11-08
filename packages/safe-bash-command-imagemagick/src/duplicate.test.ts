import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
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
