import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const operation of ["-clut", "-hald-clut"]) {
        it(`${mode}: ${operation} rejects a missing lookup without writing output`, async () => {
            const files = new Map<string, Uint8Array>();
            const filesystem = new MemoryFileSystem();
            const args = ["-size", "1x1", "xc:red", operation, "+append", "/out.png"];
            const result = mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(1);
            expect(result.stderr).toContain(`image sequence is required '${operation}'`);
            if (mode === "retained") await expect(filesystem.readFile("/out.png")).rejects.toMatchObject({ code: "ENOENT" });
            else expect(files.has("/out.png")).toBe(false);
        });
    }

    it(`${mode}: -clut consumes the lookup and produces a blue pixel`, async () => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:red", "xc:blue", "-clut", "+append", "/out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([1, 1]);
        expect([...output.data]).toEqual([0, 0, 255, 255]);
    });
}
