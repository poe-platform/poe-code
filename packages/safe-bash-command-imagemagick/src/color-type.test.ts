import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick 7.1.2-35 Q16-HDRI inputs, with identical RGB but different storage classes.
const fixtures = {
    direct: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAYAAAAb4BS0AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDdUMjA6MzM6NDErMDA6MDCAl2P4AAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA3VDIwOjMzOjQxKzAwOjAw8crbRAAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wN1QyMDozMzo0MSswMDowMKbf+psAAAAVSURBVAjXYxCxSVm1JcXmhPfsw/8BIKEGI8Ideq0AAAAASUVORK5CYII=", "base64"),
    indexed: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAMAAAABCAMAAAAsPuSGAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAJUExURRQ8ZLRkPEubw2TXsXQAAAAHdElNRQfqCwcUISlEDh3PAAAAJXRFWHRkYXRlOmNyZWF0ZQAyMDI2LTExLTA3VDIwOjMzOjQxKzAwOjAwgJdj+AAAACV0RVh0ZGF0ZTptb2RpZnkAMjAyNi0xMS0wN1QyMDozMzo0MSswMDowMPHK20QAAAAodEVYdGRhdGU6dGltZXN0YW1wADIwMjYtMTEtMDdUMjA6MzM6NDErMDA6MDCm3/qbAAAADElEQVQI12NgYGQCAAAIAATnw6/5AAAAAElFTkSuQmCC", "base64"),
};

for (const mode of ["sync", "buffered", "command"] as const) {
    async function convert(input: Uint8Array, operations: string[]) {
        const files = new Map([["in.png", input]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", ...operations, "PNG32:out.png"];
        const result = mode === "sync" ? runMagickCliSync(args, files)
            : mode === "buffered" ? await runMagickCli(args, files)
                : await createMagickCommand().execute({
                    command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs: filesystem,
                    stdin: (async function* () {})(), signal: new AbortController().signal,
                    stdout: { write: async () => {} }, stderr: { write: async () => {} },
                });
        if ("stderr" in result) expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        return decodeImage(mode === "command" ? await filesystem.readFile("/out.png") : files.get("out.png")!);
    }

    it.each([
        { input: "indexed", types: [], expected: [75, 100, 60, 255] },
        { input: "direct", types: [], expected: [75, 155, 195, 255] },
        { input: "indexed", types: ["TrueColor"], expected: [75, 155, 195, 255] },
        { input: "indexed", types: ["TrueColorAlpha"], expected: [75, 155, 195, 255] },
        { input: "direct", types: ["Palette"], expected: [75, 100, 60, 255] },
        { input: "direct", types: ["Palette", "TrueColorAlpha"], expected: [75, 155, 195, 255] },
        { input: "indexed", types: ["TrueColorAlpha", "Palette"], expected: [75, 100, 60, 255] },
    ] as const)(`applies $types before channel solarize on $input via ${mode}`, async ({ input, types, expected }) => {
        const output = await convert(fixtures[input], [...types.flatMap(type => ["-type", type]), "-channel", "R", "-solarize", "25700"]);
        expect([...output.data.slice(8, 12)]).toEqual(expected);
    });

    it.each(["TrueColor", "TrueColorAlpha", "Palette"])(`converts to %s without another operator via ${mode}`, async type => {
        const output = await convert(fixtures.indexed, ["-type", type]);
        expect([...output.data]).toEqual([...decodeImage(fixtures.indexed).data]);
    });

    it(`preserves active alpha and initializes disabled alpha for TrueColorAlpha via ${mode}`, async () => {
        const input = decodeImage(fixtures.direct);
        expect(input.data[3]).not.toBe(255);
        const output = await convert(fixtures.direct, ["-type", "truecoloralpha"]);
        expect([...output.data]).toEqual([...input.data]);
        const opaque = await convert(fixtures.direct, ["-alpha", "off", "-type", "TrueColorAlpha"]);
        expect([...opaque.data].filter((_, index) => index % 4 === 3)).toEqual([255, 255, 255]);
    });

    it.each(["TrueColor", "Palette"])(`removes alpha without losing hidden RGB for %s via ${mode}`, async type => {
        const input = encodeImage({ ...decodeImage(fixtures.direct), data: new Uint8Array([20, 60, 100, 0, 180, 100, 60, 128, 75, 155, 195, 255]) }, { format: "png", pngColorType: 6 }).data;
        const output = await convert(input, ["-type", type.toLowerCase()]);
        expect([...output.data]).toEqual([20, 60, 100, 255, 180, 100, 60, 255, 75, 155, 195, 255]);
    });

    it(`converts PGM to TrueColor before cropping via ${mode}`, async () => {
        const output = await convert(Buffer.from("P2\n2 1\n255\n17 34\n"), ["-type", "TrueColor", "-crop", "1x1+1+0"]);
        expect([output.width, output.height]).toEqual([1, 1]);
        expect([...output.data]).toEqual([34, 34, 34, 255]);
    });

    it(`limits the whole image to 256 palette colors across retained chunks via ${mode}`, async () => {
        const width = 1024, data = new Uint8Array(width * 4);
        for (let pixel = 0; pixel < width; pixel++) data.set([pixel % 256, Math.floor(pixel / 256) * 60, 75, 255], pixel * 4);
        const input = encodeImage({ ...decodeImage(fixtures.direct), width, data }, { format: "png", pngColorType: 6 }).data;
        const output = await convert(input, ["-type", "Palette"]);
        const colors = new Set<string>();
        for (let offset = 0; offset < output.data.length; offset += 4) colors.add([...output.data.slice(offset, offset + 4)].join(","));
        expect(colors.size).toBeGreaterThan(1);
        expect(colors.size).toBeLessThanOrEqual(256);
    });
}

it.each([
    { type: [], alpha: 68 },
    { type: ["-type", "TrueColorAlpha"], alpha: 68 },
    { type: ["-type", "TrueColor"], alpha: 255 },
])("writes numbered PNG output with alpha $alpha for $type", async ({ type, alpha }) => {
    const fs = new MemoryFileSystem();
    const result = await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(["-size", "1x1", "xc:#11223344", ...type, "tile-%02d.png"]).args,
        cwd: "/", env: {}, fs, stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    });
    expect(result.exitCode).toBe(0);
    expect([...decodeImage(await fs.readFile("/tile-00.png")).data]).toEqual([17, 34, 51, alpha]);
});
