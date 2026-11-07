import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runMogrifyCli } from "./index.js";

for (const retained of [false, true]) for (const mogrify of [false, true])
it.each(["impulse", "zero", "constant", "softness", "quantum"])(`denoises %s like native ImageMagick (retained=${retained}, mogrify=${mogrify})`, async kind => {
    const pixels = Uint8Array.from({ length: 256 }, (_, i) => i % 4 === 3 ? 255 : kind === "constant" ? [64, 96, 128][i % 4]! : Math.floor(i / 4) === 19 ? 255 : 0);
    const input = await sharp(pixels, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const threshold = kind === "zero" ? "0" : kind === "softness" ? "10%x0.5" : kind === "quantum" ? "6553.5" : "10%";
    const args = mogrify ? ["-wavelet-denoise", threshold, "input.png"] : ["input.png", "-wavelet-denoise", threshold, "out.png"];
    const result = await (mogrify ? runMogrifyCli : runConvertCli)(args, retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const name = mogrify ? "input.png" : "out.png";
    const output = decodeImage(retained ? await fs.readFile(`/${name}`) : files.get(name)!);
    expect([output.width, output.height]).toEqual([8, 8]);
    if (kind === "constant" || kind === "zero") expect(output.data).toEqual(pixels);
    else if (kind === "softness") expect(createHash("sha256").update(output.data).digest("hex")).toBe("976d9f1db0273b2f23cbd86367e44dacf42b05b46156e0c14ad3756b45f268d0");
    else {
        expect(Array.from(output.data.slice(76, 80))).toEqual([225, 225, 225, 255]);
        expect(Array.from(output.data.slice(0, 4))).toEqual([6, 6, 6, 255]);
        expect(createHash("sha256").update(output.data).digest("hex").slice(0, 16)).toBe("b2138ac3fdf0899c");
    }
});

for (const retained of [false, true])
it(`preserves nonopaque alpha (retained=${retained})`, async () => {
    const pixels = Uint8Array.from({ length: 256 }, (_, i) => i % 4 === 3 ? Math.floor(i / 4) * 4 : Math.floor(i / 4) === 19 ? 255 : 0);
    const input = await sharp(pixels, { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const result = await runConvertCli(["input.png", "-wavelet-denoise", "10%", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode, result.stderr).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(output.data.filter((_, i) => i % 4 === 3)).toEqual(pixels.filter((_, i) => i % 4 === 3));
    expect(Array.from(output.data.slice(76, 79))).toEqual([225, 225, 225]);
});
