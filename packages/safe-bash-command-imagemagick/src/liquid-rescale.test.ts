import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import fixtures from "./liquid-rescale-fixtures.json" with { type: "json" };
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI: identical pixels with and without a page offset.
const inputs = {
    "plain.png": "iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAIAAADUVFKvAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcMHgalNPhiAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEyOjMwOjA2KzAwOjAwNnB4HwAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMjozMDowNiswMDowMEctwKMAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTI6MzA6MDYrMDA6MDAQOOF8AAAAIklEQVQI12P8z4ACmBkZGhz/H2BsbDjI4HCQwYGRgQFFBQDAjgeJilA7BgAAAABJRU5ErkJggg==",
    "offset.png": "iVBORw0KGgoAAAANSUhEUgAAAAUAAAADCAIAAADUVFKvAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAHdElNRQfqCwcMHgalNPhiAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDEyOjMwOjA2KzAwOjAwNnB4HwAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QxMjozMDowNiswMDowMEctwKMAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMTI6MzA6MDYrMDA6MDAQOOF8AAAAEGNhTnYAAAAMAAAACQAAAAMAAAACzIEz8AAAACJJREFUCNdj/M+AApgZGRoc/x9gbGw4yOBwkMGBkYEBRQUAwI4HiYpQOwYAAAAASUVORK5CYII="
} as const;

for (const mode of ["buffered", "retained", "sync"] as const) {
    for (const input of ["plain.png", "offset.png"] as const) {
        it.each([
            ["4x3!", 4, 3, "10x9+2+2", "ff0000ff0000ff0000ff00008000808000808000808000800000ff0000ff0000ff0000ff"],
            ["3x2!", 3, 2, "7x6+2+1", "c3320acd1d14e000270a32c3141dcd2700e0"],
        ] as const)(`liquid rescales ${input} to %s (${mode})`, async (geometry, width, height, page, rgb) => {
            const bytes = Buffer.from(inputs[input], "base64");
            const files = new Map([["/input.png", bytes]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", bytes);
            const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
                : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            const result = await run(["/input.png", "-liquid-rescale", geometry, "PNG24:/output.png"]);
            expect(result.exitCode, result.stderr).toBe(0);
            const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
            expect([output.width, output.height]).toEqual([width, height]);
            expect(Buffer.from(output.data.filter((_, index) => index % 4 !== 3)).toString("hex")).toBe(rgb);
            expect((await run(["identify", "-format", "%wx%h %g", "/output.png"])).stdout)
                .toBe(`${width}x${height} ${input === "plain.png" ? `${width}x${height}+0+0` : page}`);
        });
    }
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it.each(fixtures)(`matches native seam selection, growth and precision: $name (${mode})`, async fixture => {
        const bytes = Buffer.from(fixture.input, "base64");
        const files = new Map([["/input.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        const run = (args: string[]) => mode === "sync" ? runMagickCliSync(args, files)
            : runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        const result = await run(["/input.png", "-liquid-rescale", fixture.geometry, "/output.png"]);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!);
        const expected = Buffer.from(fixture.rgba16, "hex");
        const samples = Array.from({ length: expected.length / 2 }, (_, i) => expected.readUInt16BE(i * 2));
        expect(Array.from(output.data16 ?? Uint16Array.from(output.data, value => value * 257))).toEqual(samples);
        expect((await run(["identify", "-format", "%wx%h %g", "/output.png"])).stdout).toBe(fixture.shape);
    });
}

for (const mode of ["buffered", "retained", "sync"] as const) {
    it(`supports in-place mogrify (${mode})`, async () => {
        const bytes = Buffer.from(inputs["offset.png"], "base64");
        const files = new Map([["/input.png", bytes]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        const args = ["mogrify", "-liquid-rescale", "4x3!", "/input.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, result.stderr).toBe(0);
        const output = decodeImage(mode === "retained" ? await filesystem.readFile("/input.png") : files.get("/input.png")!);
        expect(output).toMatchObject({ width: 4, height: 3, virtualCanvas: { width: 10, height: 9, x: 2, y: 2 } });
        expect(Buffer.from(output.data.filter((_, index) => index % 4 !== 3)).toString("hex"))
            .toBe("ff0000ff0000ff0000ff00008000808000808000808000800000ff0000ff0000ff0000ff");
    });
    it(`preserves the destination on invalid geometry (${mode})`, async () => {
        const bytes = Buffer.from(inputs["plain.png"], "base64"), sentinel = Buffer.from("existing output");
        const files = new Map([["/input.png", bytes], ["/output.png", sentinel]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", bytes);
        await filesystem.writeFile("/output.png", sentinel);
        const args = ["/input.png", "-liquid-rescale", "invalid", "/output.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).not.toBe(0);
        expect(result.stderr).toContain("invalid argument");
        expect(Buffer.from(mode === "retained" ? await filesystem.readFile("/output.png") : files.get("/output.png")!)).toEqual(sentinel);
    });
}

// Native LiquidRescaleImage returns DirectClass pixels; another operator must not reuse the old palette indices.
it("uses direct-color pixels for subsequent seam carving", async () => {
    const input = Buffer.from(fixtures[0]!.input, "base64");
    const files = new Map([["/input.png", input]]);
    for (const args of [
        ["/input.png", "-liquid-rescale", "5x4!", "-liquid-rescale", "4x3!", "/output.png"],
        ["/input.png", "-liquid-rescale", "5x4!", "PNG24:/direct.png"],
        ["/direct.png", "-liquid-rescale", "4x3!", "/expected.png"],
    ]) {
        const result = await runMagickCli(args, files);
        expect(result.exitCode, result.stderr).toBe(0);
    }
    expect(decodeImage(files.get("/output.png")!).data).toEqual(decodeImage(files.get("/expected.png")!).data);
});

// Native ImageMagick 7.1.2-35 treats parenthesized dimensions like plain dimensions.
for (const mode of ["buffered", "retained", "sync", "public"] as const) {
    it.each(["(4x3!)", "4x3!"])(`liquid rescales dimension geometry %s (${mode})`, async geometry => {
        const input = Buffer.concat([Buffer.from("P6\n5 4\n255\n"), Buffer.from(Array.from({ length: 60 }, (_, i) => (i * 53 + 11) % 256))]);
        const files = new Map([["/im.ppm", input], ["/out", Buffer.from("KEEP")]]);
        const filesystem = new MemoryFileSystem();
        for (const [path, bytes] of files) await filesystem.writeFile(path, bytes);
        const args = ["/im.ppm", "-liquid-rescale", geometry, "-format", "%wx%h,%Wx%H%X%Y,%r", "info:/out"];
        let stderr = "";
        const argumentValues = createCommandArguments(args);
        const result = mode === "public" ? await createMagickCommand().execute({
            command: "magick", args: argumentValues.args, argumentValues, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} },
            stderr: { async write(chunk) { stderr += new TextDecoder().decode(chunk); } }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode, stderr).toBe(0);
        const output = mode === "public" || mode === "retained" ? await filesystem.readFile("/out") : files.get("/out")!;
        expect(new TextDecoder().decode(output)).toBe("4x3,4x3+0+0,DirectClass sRGB ");
    });
}
