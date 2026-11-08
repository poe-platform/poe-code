import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI output for the issue's opaque 4×4 image.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each([
        { seed: 123, value: "0.5", channels: [], changes: { 5: 255, 54: 255 } },
        { seed: 456, value: "2", channels: [], changes: { 8: 0, 9: 255, 14: 0, 16: 0, 17: 255, 24: 255, 29: 255, 36: 0, 38: 255, 41: 0, 50: 255, 53: 0, 54: 0, 56: 255 } },
        { seed: 123, value: "2", channels: ["-channel", "G"], changes: { 13: 0, 17: 255, 29: 0, 53: 255 } },
        { seed: 123, value: "0", channels: [], changes: {} },
    ])(`matches native impulse noise via ${mode}: $seed $value $channels`, async ({ seed, value, channels, changes }) => {
        const pixels = Uint8Array.from({ length: 64 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
        // Native PNG encoding removes the fully opaque alpha channel.
        const input = await sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } }).removeAlpha().png().toBuffer();
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        if (mode === "retained") await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-seed", String(seed), ...channels, "-evaluate", "ImpulseNoise", value, "/out.png"];
        const result = mode === "sync" ? runConvertCliSync(args, files)
            : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0 });
        for (const [index, value] of Object.entries(changes)) pixels[Number(index)] = value;
        const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
        expect([...decodeImage(output).data]).toEqual([...pixels]);
    });
}

it("continues seeded noise across retained chunks and resets for each image", async () => {
    const input = await sharp({ create: { width: 5000, height: 1, channels: 3, background: { r: 80, g: 120, b: 160 } } }).png().toBuffer();
    const files = new Map([["/input.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", "/input.png", "-seed", "123", "-evaluate", "ImpulseNoise", "2", "/out-%d.png"];
    expect((await runConvertCli(args, files)).exitCode).toBe(0);
    expect((await runConvertCli(args, { filesystem, cwd: "/" })).exitCode).toBe(0);
    const expected = decodeImage(files.get("/out-0.png")!).data;
    expect(decodeImage(files.get("/out-1.png")!).data).toEqual(expected);
    for (const index of [0, 1]) expect(decodeImage(await filesystem.readFile(`/out-${index}.png`)).data).toEqual(expected);
});
