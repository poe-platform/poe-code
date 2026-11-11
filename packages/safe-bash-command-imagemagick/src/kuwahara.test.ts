import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { kuwaharaPixelSteps } from "./kuwahara-kernel.js";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native ImageMagick 7.1.2 Q16-HDRI RGBA8 reference outputs.
const cases = [
{ name: 'default', settings: [], expected: '203040ff203040ff253545ff3e4e5effacbcccffb0c0d0ffb0c0d0ffb0c0d0ff213141ff213141ff263646ff3e4e5effacbcccffb1c1d0ffb1c0d0ffb1c0d0ff213141ff213141ff283848ff3e4e5effafbfceffb4c3d2ffb6c5d4ffb6c5d4ff213141ff203040ff253545ff3e4e5effb4c2d0ffb8c6d5ffb6c5d4ffb6c5d4ff203040ff203040ff243444ff3c4c5cffacbcccffb1c1d0ffb6c5d4ffb6c5d4ff203040ff203040ff243444ff3b4b5bffacbcccffb0c0d0ffb0c0d0ffb0c0d0ff203040ff203040ff243444ff3a4a5affacbcccffb0c0d0ffb0c0d0ffb0c0d0ff203040ff203040ff243444ff3a4a5affacbcccffb0c0d0ffb0c0d0ffb0c0d0ff' },
{ name: 'tile', settings: ['-virtual-pixel', 'tile'], expected: '2c3c4cff3e4e5eff2c3c4cff3e4e5effa7b7c7ff96a6b6ffa7b7c7ff96a6b6ff2c3c4cff3e4e5eff2c3c4cff3e4e5effa8b8c8ff96a6b6ffa8b8c8ff96a6b6ff2c3c4cff3c4c5cff2c3c4cff3c4c5cffabbacaff99a9b8ffabbacaff99a9b8ff2c3c4cff3e4e5eff2c3c4cff3e4e5effafbeccff9eacbaffafbeccff9eacbaff2a3a4aff3c4c5cff2a3a4aff3c4c5cffa8b8c8ff96a6b6ffa8b8c8ff96a6b6ff293949ff3b4b5bff293949ff3b4b5bffa7b7c7ff96a6b6ffa7b7c7ff96a6b6ff293949ff3a4a5aff293949ff3a4a5affa7b7c7ff96a6b6ffa7b7c7ff96a6b6ff2a3a4aff3c4c5cff2a3a4aff3c4c5cffa8b8c8ff96a6b6ffa8b8c8ff96a6b6ff' },
{ name: 'mirror', settings: ['-virtual-pixel', 'mirror'], expected: '203040ff203040ff253545ff3e4e5effacbcccffb0c0d0ffb0c0d0ffb0c0d0ff203040ff213141ff263646ff3e4e5effacbcccffb1c1d0ffb1c1d0ffb1c1d0ff203040ff213141ff283848ff3e4e5effafbfceffb4c3d2ffb8c6d5ffb9c7d5ff203040ff203040ff253545ff3e4e5effb4c2d0ffb9c7d5ffb8c6d5ffb9c7d5ff203040ff203040ff243444ff3c4c5cffacbcccffb1c1d0ffb8c6d5ffb9c7d5ff203040ff203040ff243444ff3b4b5bffacbcccffb0c0d0ffb0c0d0ffb0c0d0ff203040ff203040ff243444ff3a4a5affacbcccffb0c0d0ffb0c0d0ffb0c0d0ff203040ff203040ff243444ff3a4a5affacbcccffb0c0d0ffb0c0d0ffb0c0d0ff' },
{ name: 'red', settings: ['-channel', 'R'], expected: '203040ff203040ff253040ff3b3040ffacc0d0ffb0c0d0ffb0c0d0ffb0c0d0ff213040ff213040ff263040ff3c3040ffacc0d0ffb1c0d0ffb1c0d0ffb1c0d0ff203040ff223040ff283848ff3e3848ffafc0d0ffb4c0d0ffb3c0d0ffb6c0d0ff213040ff203040ff253040ff3b3040ffb4d0dcffb8d0dcffb6c0d0ffb3c0d0ff203040ff203040ff243040ff3a3040ffacc0d0ffb1c0d0ffb1c0d0ffb6c0d0ff203040ff203040ff243040ff3b3040ffacc0d0ffb0c0d0ffb0c0d0ffb0c0d0ff203040ff203040ff243040ff3a3040ffacc0d0ffb0c0d0ffb0c0d0ffb0c0d0ff203040ff203040ff243040ff3a3040ffacc0d0ffb0c0d0ffb0c0d0ffb0c0d0ff' }
];
for (const mode of ["command", "buffered", "retained"] as const)
for (const fixture of [...cases, { name: "constant", settings: [], expected: "406080ff".repeat(64) }])
it(`Kuwahara ${fixture.name} (${mode})`, async () => {
    const pixels = new Uint8Array(256);
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) pixels.set(fixture.name === "constant" ? [64, 96, 128, 255] : x < 4 ? [32, 48, 64, 255] : [176, 192, 208, 255], (y * 8 + x) * 4);
    if (fixture.name !== "constant") {
        pixels.set([64, 80, 96, 255], (2 * 8 + 2) * 4);
        pixels.set([255, 255, 255, 255], (3 * 8 + 6) * 4);
    }
    const input = await sharp(pixels, { raw: { width: 8, height: 8, channels: 4 } }).removeAlpha().png().toBuffer();
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", ...fixture.settings, "-kuwahara", "2x1", "+channel", "-depth", "8", "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([8, 8]);
    const expected = Buffer.from(fixture.expected, "hex");
    // Symmetric quadrants tie mathematically. Native floating-point accumulation
    // can choose either center; constrain those pixels to the two valid samples.
    const ties = fixture.name === "tile" ? [[17, "3c4c5cff", "3e4e5eff"], [19, "3c4c5cff", "3e4e5eff"]] as const
        : fixture.name === "red" ? [[16, "203040ff", "213040ff"], [17, "223040ff", "213040ff"]] as const : [];
    for (const [pixel, a, b] of ties) {
        const actual = output.data.subarray(pixel * 4, pixel * 4 + 4);
        expect([a, b]).toContain(Buffer.from(actual).toString("hex"));
        expected.set(actual, pixel * 4);
    }
    expect(Buffer.from(output.data)).toEqual(expected);
});

for (const fixture of [
{ geometry: '0x1', expected: '957485867d8085868a84849aa67b73b5b37467c1ae629ca08273848d807c7498997361b0a66c56bdb451a8a98265878f7b736f96937057ae9f6c48bb' },
{ geometry: '1x0', expected: '133b1f4042526665a080f4afcf973bd4cf973bd4e921e5f25cdc10838bf357a88bf357a8a57d01c6e921e5f2474f737c474f737ca57d01c6a57d01c6' },
{ geometry: '1x2', expected: '8c81697372837576a08889ada08889adbb7b77c6bb6a989e89758388928174a8928174a89f6850bcd153b6c398619197847760a3847760a39f6850bc' },
{ geometry: '2x1', expected: '8a726f747d757775ad817bb7ba7d6cc4ba7d6cc4a970868b95758586a67b74b59f6b48bb9f6b48bbcd4bb7bfb452a8a98165878e9f6b48bb9f6b48bb' }
]) it(`Kuwahara alpha and geometry ${fixture.geometry}`, async () => {
    const pixels = Uint8Array.from({ length: 60 }, (_, n) => {
        const i = Math.floor(n / 4);
        return [(i * 47 + 19) % 256, (i * 23 + 59) % 256, (i * 71 + 31) % 256, 64 + (i * 37) % 192][n % 4]!;
    });
    const input = await sharp(pixels, { raw: { width: 5, height: 3, channels: 4 } }).png().toBuffer();
    const files = new Map([["/in.png", input]]);
    const result = await runMagickCli(["/in.png", "-kuwahara", fixture.geometry, "-depth", "8", "/out.png"], files);
    expect(result).toMatchObject({ exitCode: 0 });
    expect(Buffer.from(decodeImage(files.get("/out.png")!).data).toString("hex")).toBe(fixture.expected);
});

it("bounds raster transfers across chunk boundaries", () => {
    const width = 2053, pixels = new Uint8Array(width * 4);
    for (let i = 0; i < width; i++) pixels.set([64, 96, 128, 255], i * 4);
    const output = new Uint8Array(pixels.length);
    const steps = kuwaharaPixelSteps({ width, height: 1 }, { width: 1, height: 1 }, { r: 0, g: 0, b: 0, a: 255 }, "tile");
    let next = steps.next();
    while (!next.done) {
        const request = next.value;
        if (!request) next = steps.next();
        else if (request.kind === "read") {
            expect(request.length).toBeLessThanOrEqual(4096);
            next = steps.next(pixels.subarray(request.position, request.position + request.length));
        } else {
            expect(request.data.length).toBeLessThanOrEqual(16384);
            if (request.evaluate) {
                expect(Array.from(new Float64Array(request.data.slice().buffer))).toEqual(Array.from(pixels.subarray(request.position, request.position + request.data.length / 8)));
            } else {
                expect(request.highDepth).toBe(true);
                output.set(Uint8Array.from(new Uint16Array(request.data.slice().buffer), value => value / 257), request.position);
            }
            next = steps.next();
        }
    }
    expect(output).toEqual(pixels);
});

it.each([-1, 5000, Infinity, NaN])("rejects unsupported radius %s before reading pixels", radius => {
    const steps = kuwaharaPixelSteps({ width: 1, height: 1 }, { width: radius }, { r: 0, g: 0, b: 0, a: 255 });
    expect(() => steps.next()).toThrow("Kuwahara radius or sigma exceeds limit");
});

// Native ImageMagick 7.1.2-31 Q16-HDRI, with varying RGB and alpha samples.
for (const mode of ["command", "buffered", "retained"] as const)
for (const fixture of [
    { settings: ["-channel", "R"], expected: "5e7bd6317bb09f7a77b18c7a7bb09f7a7bb09e79a0429d78a40b66c1a40b66c16279d443845886a17c789d82916a85a08181a681a149a489a60964d3a60964d372a81671827156718a7954797d7954428a795479ae786681cd38a681cd38a6816e988762928a6580998a65807a886d527c896452ac917691cb5bb691b228977272a81671959a759094997499839974627a987d6279988661a66ac520a66ac52088ea45a0928a6580998a65807a886d527c896452ac9176916f7ad5306f7ad53081da3590959a7590949974998399746274c29d7879988661a66ac520628be6418afb56b17aa88d727fa9847275c39e7974c29d786fc29d7874c29d78628be641" },
    { settings: [], expected: "5e90915d7b947f7f78997a7b7b947f7f92438a879a1d7898a41772a8a41772a86e6c75778f5579898f5c78818f5579898f5c78819c237c9ba61c76aaa61c76aa6865936f90706178916d647e9070617892438a87a1348397ab2a7da3ab2a7da36e6c75778f5579898f5c78818f5579898f5c78818d617977935f7d77b977866e7588537a907061787cbf5a657ac65c6380c264647ac65c6380c264649899885a81c2667a7bc5697377cc6c6f76d16e6e77d2726b76d16e6e77d2726b6fb792538ae05a9077cc707675d0747475d5757374d7786f75d5757374d7786f62bf98548ae05a9077cc707675d0747477cc707674d7786f75d5757374d7786f62bf9854" },
]) it(`Kuwahara transparent channel selection ${fixture.settings.join(" ") || "default"} (${mode})`, async () => {
    const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAYAAADED76LAAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAGYktHRAD/AP8A/6C9p5MAAAAldEVYdGRhdGU6Y3JlYXRlADIwMjYtMTEtMDhUMDE6Mzc6NTIrMDA6MDDGLKOTAAAAJXRFWHRkYXRlOm1vZGlmeQAyMDI2LTExLTA4VDAxOjM3OjUyKzAwOjAwt3EbLwAAACh0RVh0ZGF0ZTp0aW1lc3RhbXAAMjAyNi0xMS0wOFQwMTozNzo1MiswMDowMOBkOvAAAABTSURBVBjTY1aovmZYs+r6mpvsW87VrPy3+ibbgnPVF/6uvlG04Oyi839XMf3580dZWVkZJ8WET1JZWfkPEwEDlJkIGPCHiYABykwEDPjDRMAAZQABPYSciDxQVgAAAABJRU5ErkJggg==", "base64");
    const files = new Map([["/in.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/in.png", input);
    const args = ["/in.png", ...fixture.settings, "-kuwahara", "2x1", "+channel", "PNG32:/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "buffered" ? files.get("/out.png")! : await fs.readFile("/out.png"));
    expect([output.width, output.height]).toEqual([8, 8]);
    expect(Buffer.from(output.data).toString("hex")).toBe(fixture.expected);
});
