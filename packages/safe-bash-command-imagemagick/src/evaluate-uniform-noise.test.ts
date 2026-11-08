import { createHash } from "node:crypto";
import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { runConvertCli, runConvertCliSync } from "./index.js";
import fixtures from "./evaluate-uniform-noise-fixtures.json" with { type: "json" };

// Native ImageMagick 7.1.2 Q16 output, including opaque and translucent PNGs.
for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(fixtures)(`matches seeded UniformNoise $seed $value $channels alpha=$alpha via ${mode}`, async fixture => {
        const pixels = Uint8Array.from({ length: 64 }, (_, i) => i % 4 === 3
            ? (fixture.alpha ? (40 + i * 3) % 256 : 255)
            : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
        const image = sharp(pixels, { raw: { width: 4, height: 4, channels: 4 } });
        const input = await (fixture.alpha ? image : image.removeAlpha()).png().toBuffer();
        const files = new Map([["/input.png", input]]);
        const filesystem = new MemoryFileSystem();
        if (mode === "retained") await filesystem.writeFile("/input.png", input);
        const args = ["/input.png", "-seed", String(fixture.seed), ...fixture.channels, "-evaluate", "UniformNoise", fixture.value, "/out.png"];
        for (let repeat = 0; repeat < 2; repeat++) {
            const result = mode === "sync" ? runConvertCliSync(args, files)
                : await runConvertCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result).toMatchObject({ exitCode: 0 });
            const output = mode === "retained" ? await filesystem.readFile("/out.png") : files.get("/out.png")!;
            expect([...decodeImage(output).data]).toEqual(fixture.expected);
        }
    });
}

it("preserves the native random stream across retained chunks and resets for each image", async () => {
    const pixels = Uint8Array.from({ length: 65 * 65 * 4 }, (_, i) => i % 4 === 3 ? 255
        : (Math.floor(i / 4) * [37, 91, 53][i % 4]! + 17) % 256);
    const input = await sharp(pixels, { raw: { width: 65, height: 65, channels: 4 } }).removeAlpha().png().toBuffer();
    const files = new Map([["/input.png", input]]);
    const filesystem = new MemoryFileSystem();
    await filesystem.writeFile("/input.png", input);
    const args = ["/input.png", "-seed", "123", "-evaluate", "UniformNoise", "0.5", "/out.png"];
    expect(await runConvertCli(args, files)).toMatchObject({ exitCode: 0 });
    expect(await runConvertCli(args, { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0 });
    const buffered = decodeImage(files.get("/out.png")!).data;
    const retained = decodeImage(await filesystem.readFile("/out.png")).data;
    expect(retained).toEqual(buffered);
    expect(createHash("sha256").update(retained).digest("hex"))
        .toBe("da867e2fdb9f8d98d2d563a29c22ee23e01d4d32ab232acfc3feebb524bcf2c2");
    expect(await runConvertCli(["/input.png", ...args.slice(0, -1), "/out-%d.png"], { filesystem, cwd: "/" })).toMatchObject({ exitCode: 0 });
    expect(decodeImage(await filesystem.readFile("/out-0.png")).data).toEqual(retained);
    expect(decodeImage(await filesystem.readFile("/out-1.png")).data).toEqual(retained);
});
