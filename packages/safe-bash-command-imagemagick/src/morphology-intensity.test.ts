import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runConvertCli } from "./index.js";
import fixture from "./morphology-intensity-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16 reference: all pixels, including image boundaries.
for (const mode of ["command", "buffered", "retained"] as const)
for (const [method, pixels] of Object.entries(fixture.expected))
for (const spelling of method.endsWith("Intensity") ? [method, method.replace("Intensity", "I")] : [method])
it(`selects morphology pixels for ${spelling} (${mode})`, async () => {
    const input = await sharp(Buffer.from(fixture.input, "hex"), { raw: { width: 7, height: 5, channels: 3 } }).png().toBuffer();
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", "-morphology", spelling, "Square:1", "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : await runConvertCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result, JSON.stringify(result)).toMatchObject({ exitCode: 0 });
    const actual = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png")).data;
    const expected = pixels.split(" ").flatMap(pixel => [...Buffer.from(pixel, "hex"), 255]);
    expect([...actual]).toEqual(expected);
});

for (const retained of [false, true]) {
    it(`preserves selected RGBA pixels and channel masks (retained=${retained})`, async () => {
        const pixels = [[200, 0, 0, 64], [0, 160, 0, 128], [0, 0, 240, 192]];
        const input = await sharp(Uint8Array.from(pixels.flat()), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
        for (const [method, indices] of [["DilateI", [1, 1, 1]], ["ErodeI", [0, 2, 2]], ["OpenI", [0, 0, 2]], ["CloseI", [1, 1, 1]], ["OpenI:2", [2, 2, 2]], ["CloseI:0", [0, 1, 2]]] as const) {
            for (const channel of [undefined, "R", "A"]) {
                // Compound masked passes feed their partially updated pixels into the next pass.
                if (channel && !["DilateI", "ErodeI"].includes(method)) continue;
                const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
                await fs.writeFile("/in.png", input);
                const args = ["/in.png", ...(channel ? ["-channel", channel] : []), "-morphology", method, "3x1:1,1,1", "+channel", "/out.png"];
                expect(await runConvertCli(args, retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
                const actual = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data;
                const expected = indices.flatMap((index, x) => pixels[index]!.map((value, c) => !channel || c === (channel === "R" ? 0 : 3) ? value : pixels[x]![c]!));
                expect([...actual], `${method} ${channel ?? "RGBA"}`).toEqual(expected);
            }
        }
    });

    it(`keeps scan-order ties and reflects asymmetric dilation kernels (retained=${retained})`, async () => {
        const pixels = [[64, 128, 32, 64], [64, 128, 32, 128], [64, 128, 32, 192]];
        const input = await sharp(Uint8Array.from(pixels.flat()), { raw: { width: 3, height: 1, channels: 4 } }).png().toBuffer();
        for (const [method, kernel, indices] of [
            ["DilateI", "3x1:1,nan,1", [0, 0, 1]],
            ["ErodeI", "3x1:1,nan,1", [0, 0, 1]],
            ["DilateI", "3x1:1,nan,nan", [1, 2, 2]],
            ["ErodeI", "3x1:1,nan,nan", [0, 0, 1]],
        ] as const) {
            const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.png", input);
            expect(await runConvertCli(["/in.png", "-morphology", method, kernel, "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
            const actual = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!).data;
            expect([...actual], `${method} ${kernel}`).toEqual(indices.flatMap(index => pixels[index]!));
        }
    });
}

for (const retained of [false, true])
it(`compares full-depth pixels across retained I/O chunks (retained=${retained})`, async () => {
    const width = 1027;
    const dark = [0x4401, 0, 0, 30000], light = [0x4402, 0, 0, 40000];
    const pixels = Array.from({ length: width }, (_, x) => x === 1024 ? light : dark).flat();
    const input = encodeImage({ width, height: 1, data: Uint8Array.from(pixels, value => Math.round(value / 257)),
        data16: Uint16Array.from(pixels), format: "png", space: "srgb", channels: 4, depth: "ushort", density: 72, hasAlpha: true
    }, { format: "png" }).data;
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const filesystem = new Proxy(fs, { get(target, key) {
        if (key === "readFile" || key === "writeFile") return () => { throw new Error("whole-file morphology I/O forbidden"); };
        const value = Reflect.get(target, key, target);
        return typeof value === "function" ? value.bind(target) : value;
    } });
    expect(await runConvertCli(["/in.png", "-morphology", "DilateI", "3x1:1,1,1", "/out.png"], retained ? { filesystem, cwd: "/" } : files)).toMatchObject({ exitCode: 0 });
    const actual = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([...actual.data16!]).toEqual(Array.from({ length: width }, (_, x) => x >= 1023 && x <= 1025 ? light : dark).flat());
});
