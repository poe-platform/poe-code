import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync"] as const) {
    // Native ImageMagick 7 Q16-HDRI, 9x1 grayscale impulse resized to 27x1.
    it.each([
        ["Mitchell", [32, 32, 32, 32, 32, 32, 32, 32, 28, 26, 43, 98, 168, 203, 168, 98, 43, 26, 28, 32, 32, 32, 32, 32, 32, 32, 32]],
        ["Lanczos", [32, 32, 32, 32, 32, 35, 38, 32, 14, 4, 32, 105, 188, 224, 188, 105, 32, 4, 14, 32, 38, 35, 32, 32, 32, 32, 32]],
        ["Point", [32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 224, 224, 224, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32, 32]]
    ])(`${mode}: preserves the %s resize filter`, async (filter, expected) => {
        const input = await sharp(Uint8Array.from([32, 32, 32, 32, 224, 32, 32, 32, 32]), {
            raw: { width: 9, height: 1, channels: 1 }
        }).png().toBuffer();
        const files = new Map([["/impulse.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/impulse.png", input);
        const args = ["/impulse.png", "-filter", filter.toLowerCase(), "-resize", "27x1!", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!);
        expect([output.width, output.height]).toEqual([27, 1]);
        expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });

    it(`${mode}: rejects an unknown resize filter without publishing output`, async () => {
        const input = await sharp(Uint8Array.from([32, 32, 32, 32, 224, 32, 32, 32, 32]), {
            raw: { width: 9, height: 1, channels: 1 }
        }).png().toBuffer();
        const files = new Map([["/impulse.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/impulse.png", input);
        const args = ["/impulse.png", "-filter", "InvalidName", "-resize", "27x1!", "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(1);
        expect(result.stderr).toContain("unrecognized image filter 'InvalidName'");
        expect(result.stdout).toBe("");
        expect(result.stdoutBytes).toBeUndefined();
        expect([...files.keys()]).toEqual(["/impulse.png"]);
        expect(await filesystem.readdir("/")).toEqual([{ name: "impulse.png", type: "file" }]);
    });
}
