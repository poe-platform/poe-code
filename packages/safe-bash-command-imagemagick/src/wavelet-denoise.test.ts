import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments, type CommandContext } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli, runMogrifyCli } from "./index.js";

for (const mode of ["command", "memory"] as const)
it.each(["0b10", "0o10", "0", "6%"])(`validates threshold %s before replacing the destination (${mode})`, async threshold => {
    const input = await sharp(new Uint8Array(8 * 8 * 4).fill(255), { raw: { width: 8, height: 8, channels: 4 } }).png().toBuffer();
    const keep = new TextEncoder().encode("KEEP");
    const fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    await fs.writeFile("/out.png", keep);
    const files = new Map([["/input.png", input], ["/out.png", keep]]);
    const args = ["/input.png", "-wavelet-denoise", threshold, "PNG32:/out.png"];
    const argumentValues = createCommandArguments(args);
    const context = {
        command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs,
        signal: new AbortController().signal, stdin: (async function* () {})(),
        stdout: { async write() {} }, stderr: { async write() {} }, registerCleanup() {}
    } as unknown as CommandContext;
    const result = mode === "command" ? await createMagickCommand().execute(context) : await runConvertCli(args, files);
    const output = mode === "command" ? await fs.readFile("/out.png") : files.get("/out.png")!;
    if (threshold === "0" || threshold === "6%") {
        expect(result.exitCode).toBe(0);
        expect(decodeImage(output).data).toEqual(new Uint8Array(8 * 8 * 4).fill(255));
    } else {
        expect(result.exitCode).not.toBe(0);
        expect(output).toEqual(keep);
    }
});

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
