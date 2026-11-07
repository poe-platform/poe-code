import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync, runMogrifyCli } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "mogrify", "retained-mogrify"] as const) {
    it.each([
        ["+filter"],
        ["-filter", "Point", "+filter"],
        ["-filter", "Lanczos", "+filter"],
        ["+filter", "-filter", "Point", "+filter"]
    ])(`${mode}: restores default resize filtering with %j`, async (...settings) => {
        const input = await sharp(Uint8Array.from([32, 32, 32, 32, 224, 32, 32, 32, 32]), {
            raw: { width: 9, height: 1, channels: 1 }
        }).png().toBuffer();
        const files = new Map([["/impulse.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/impulse.png", input);
        const retained = mode === "retained" || mode === "retained-mogrify";
        const mogrify = mode === "mogrify" || mode === "retained-mogrify";
        const options = [...settings, "-resize", "27x1!"];
        const args = ["/impulse.png", ...options, "/out.png"];
        const context = retained ? { filesystem, cwd: "/" } : files;
        const result = mogrify ? await runMogrifyCli([...options, "/impulse.png"], context)
            : mode === "sync" ? runConvertCliSync(args, files) : await runConvertCli(args, context);
        expect(result.exitCode, result.stderr).toBe(0);
        const path = mogrify ? "/impulse.png" : "/out.png";
        const output = decodeImage(retained ? await filesystem.readFile(path) : files.get(path)!);
        // Native ImageMagick default/Mitchell output for the 9x1 impulse.
        const expected = [32, 32, 32, 32, 32, 32, 32, 32, 28, 26, 43, 98, 168, 203, 168, 98, 43, 26, 28, 32, 32, 32, 32, 32, 32, 32, 32];
        expect([output.width, output.height]).toEqual([27, 1]);
        expect([...output.data]).toEqual(expected.flatMap(value => [value, value, value, 255]));
    });
}
