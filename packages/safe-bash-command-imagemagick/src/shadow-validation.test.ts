import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(["junk", "+2+3", "60xjunk", "junkx2", "x", "", "Infinity"])(`rejects invalid shadow geometry %s without writing output (${mode})`, async geometry => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const backend = mode === "retained" ? { filesystem, cwd: "/" } : files;
        for (const existing of [false, true]) {
            const original = Uint8Array.of(1, 2, 3);
            if (existing) {
                files.set("/out.png", original);
                await filesystem.writeFile("/out.png", original);
            }
            const args = ["-size", "5x4", "xc:red", "-shadow", geometry, "/out.png"];
            const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, backend);
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain("invalid argument for option '-shadow'");
            if (mode === "retained") {
                if (existing) expect(await filesystem.readFile("/out.png")).toEqual(original);
                else await expect(filesystem.readFile("/out.png")).rejects.toThrow();
            } else expect(files.get("/out.png")).toEqual(existing ? original : undefined);
        }
    });

    it.each(["60x0+1+2", "6e1x0+1+2"])(`preserves valid shadow geometry %s (${mode})`, async geometry => {
        const files = new Map<string, Uint8Array>(), filesystem = new MemoryFileSystem();
        const args = ["-size", "5x4", "xc:none", "-fill", "red", "-draw", "rectangle 1,1 3,2", "-shadow", geometry, "/out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files) : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const image = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([image.width, image.height]).toEqual([5, 4]);
        expect(image.virtualCanvas).toEqual({ width: 6, height: 6, x: 1, y: 2 });
        expect(image.data[(1 * 5 + 1) * 4 + 3]).toBe(153);
    });
}
