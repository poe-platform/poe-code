import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([false, true])(`${mode}: rejects unknown functions without changing output (existing=%s)`, async existing => {
        const input = await sharp(new Uint8Array([255, 255, 255, 255]), { raw: { width: 1, height: 1, channels: 4 } }).png().toBuffer();
        const files = new Map([["in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        if (existing) {
            files.set("out.png", input);
            await filesystem.writeFile("/out.png", input);
        }
        const args = ["in.png", "-function", "Bogus", "1", "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unrecognized function '-function' 'Bogus'");
        if (existing) {
            expect(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")).toEqual(input);
        } else {
            expect(files.has("out.png")).toBe(false);
            expect(await filesystem.readdir("/")).toHaveLength(1);
        }
    });

    it.each([
        ["Polynomial", "0,0.25", 64],
        ["Sinusoid", "1,90,0.5,0.5", 255],
        ["ArcSin", "1,0.5,1,0.5", 0],
        ["ArcTan", "1,0,1,0.5", 128],
        ["pOlYnOmIaL", "0,0.25", 64],
    ] as const)(`${mode}: preserves supported function %s`, async (name, parameters, expected) => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["-size", "1x1", "xc:black", "-function", name, parameters, "out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("out.png")!;
        expect([...decodeImage(output).data]).toEqual([expected, expected, expected, 255]);
    });
}
