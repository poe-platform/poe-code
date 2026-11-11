import { expect, it } from "vitest";
import sharp, { decodeImage, encodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli, runMagickCliSync, runConvertCli } from "./index.js";

// Native ImageMagick 7.1.2: 8x8 gradient:black-white with red rectangle 2,2 5,5.
const input = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAgAAAAIBAMAAAA2IaO4AAAAIGNIUk0AAHomAACAhAAA+gAAAIDoAAB1MAAA6mAAADqYAAAXcJy6UTwAAAAbUExURQAAACQkJElJSf8AAG1tbZKSkra2ttvb2////0PA254AAAABYktHRAiG3pV6AAAAB3RJTUUH6gsFBDAlqE4ZDwAAACV0RVh0ZGF0ZTpjcmVhdGUAMjAyNi0xMS0wNVQwNDo0ODozNyswMDowMJ4uOvcAAAAldEVYdGRhdGU6bW9kaWZ5ADIwMjYtMTEtMDVUMDQ6NDg6MzcrMDA6MDDvc4JLAAAAKHRFWHRkYXRlOnRpbWVzdGFtcAAyMDI2LTExLTA1VDA0OjQ4OjM3KzAwOjAwuGajlAAAAClJREFUCNdjYAABQSBgUDI2VmJwMTZ2YQg1Ng5lSDM2TmMoBwKGDiAAAGTDCBsiD8KiAAAAAElFTkSuQmCC", "base64");
const cases = [["0", "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AK6u/wD///8A////AP///wD///8Arq7/AAAA/wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////AP///wD/////AAD//wAA//8AAP//AAD/AP///wD///8A////AP////8AAP//AAD//wAA//8AAP8A////AP///wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////CP///wD///8A////AP///wD///8A////AP///wj////////////////////9/////f///////////////////w=="], ["1", "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AEZG/wCPj/8A2Nj/ANjY/wCPj/8ARkb/AAAA/wMDA/8Aubn//wAA//8AAP//AAD//wAA/wC5uf8DAwP/AAAA/wD/////AAD/AAAA/wAAAP//AAD/AP///wAAAP8DAwP/AP////8AAP8AAAD/AAAA//8AAP8A////AwMD/wAAAP8A/////wAA/2wAAP9sAAD//wAA/wD///8AAAD/AwMD/wC5uf8A////AP///wD///8A////ALm5/wMDA/9sbGz/bGxs/2xsbP9sbGz/bGxs/2xsbP9sbGz/bGxs/w=="], ["3", "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AMjI/wD///8A////AP///wD///8AyMj/AAAA/wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////AP///wD/////AAD//wAA//8AAP//AAD/AP///wD///8A////AP////8AAP//AAD//wAA//8AAP8A////AP///wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////gP///wD///8A////AP///wD///8A////AP///4D//////////////////////////////////////////////w=="], ["2.2", "AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AAAA/wAAAP8AAAD/AMjI/wD///8A////AP///wD///8AyMj/AAAA/wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////AP///wD/////AAD//wAA//8AAP//AAD/AP///wD///8A////AP////8AAP//AAD//wAA//8AAP8A////AP///wD///8A/////wAA//8AAP//AAD//wAA/wD///8A////gP///wD///8A////AP///wD///8A////AP///4D//////////////////////////////////////////////w=="]] as const;
for (const retained of [false, true])
it.each(cases)(`matches native edge radius %s (retained=${retained})`, async (radius, expected) => {
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", "-edge", radius, "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    const actual = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect(actual.data).toEqual(new Uint8Array(Buffer.from(expected, "base64")));
});

for (const retained of [false, true])
for (const highDepth of [false, true])
it(`preserves unselected alpha across edge output chunks (retained=${retained}, highDepth=${highDepth})`, async () => {
    const width = 1031, pixels = Uint8Array.from({ length: width * 4 }, (_, i) => i % 256);
    const data16 = Uint16Array.from(pixels, (value, i) => value * 256 + (i * 17 + 11) % 256);
    const input = highDepth ? encodeImage({ width, height: 1, data: pixels, data16, format: "png", density: 72, channels: 4,
        hasAlpha: true, space: "srgb", depth: "ushort" }, { format: "png" }).data
        : await sharp(pixels, { raw: { width, height: 1, channels: 4 } }).png().toBuffer();
    const files = new Map([["input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    expect((await runConvertCli(["input.png", "-channel", "RGB", "-edge", "3", "+channel", "out.png"], retained ? { filesystem: fs, cwd: "/" } : files)).exitCode).toBe(0);
    const actual = decodeImage(retained ? await fs.readFile("/out.png") : files.get("out.png")!);
    expect((highDepth ? actual.data16! : actual.data).filter((_, i) => i % 4 === 3))
        .toEqual((highDepth ? data16 : pixels).filter((_, i) => i % 4 === 3));
});

// ImageMagick 7.1.2: six opaque 2x2 color blocks, -edge 1, RGBA8 output.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const channel of [undefined, "RGB", "A"] as const)
it(`${mode}: edge filters selected channels (${channel ?? "default RGBA"})`, async () => {
    const colors = [[255,0,0], [0,255,0], [0,0,255], [255,255,0], [0,255,255], [255,0,255]];
    const pixels = Uint8Array.from(Array.from({ length: 24 }, (_, i) => [...colors[Math.floor(i / 12) * 3 + Math.floor(i % 6 / 2)]!, 255]).flat());
    const input = await sharp(pixels, { raw: { width: 6, height: 4, channels: 4 } }).png().toBuffer();
    const files = new Map([["/input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = ["/input.png", ...(channel ? ["-channel", channel] : []), "-edge", "1", "+channel", "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    const rgb = [0,0,0, 255,0,0, 0,255,0, 0,255,0, 0,0,255, 0,0,0,
        0,0,0, 255,0,0, 0,255,0, 0,255,0, 0,0,255, 0,0,0,
        0,255,0, 255,255,0, 0,255,255, 0,255,255, 255,0,255, 255,0,0,
        0,0,0, 255,0,0, 0,0,255, 0,255,0, 255,0,0, 0,0,0];
    expect([...output.data]).toEqual(Array.from(pixels, (value, i) => i % 4 === 3
        ? channel === "RGB" ? 255 : 0
        : channel === "A" ? value : rgb[Math.floor(i / 4) * 3 + i % 4]!));
});

for (const mode of ["command", "buffered", "retained", "sync"] as const)
it(`${mode}: preserves sub-byte contrast in 16-bit edge convolution`, async () => {
    const width = 32, height = 24;
    const data16 = Uint16Array.from({ length: width * height * 4 }, (_, i) => {
        if (i % 4 === 3) return 65535;
        const x = Math.floor(i / 4) % width, y = Math.floor(i / 4 / width);
        return (y === 5 && x >= 2 && x <= 29) ||
            ((y === 10 || y === 19) && x >= 8 && x <= 21) ||
            ((x === 8 || x === 21) && y >= 10 && y <= 19) ? 0x4020 : 0x4000;
    });
    const input = encodeImage({ width, height, data16, data: Uint8Array.from(data16, v => Math.round(v / 257)),
        format: "png", density: 72, channels: 3, hasAlpha: false, space: "srgb", depth: "ushort" }, { format: "png" }).data;
    expect(decodeImage(input).data16).toEqual(data16);
    const files = new Map([["/input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = ["/input.png", "-edge", "1", "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    const samples = output.data16 ?? Uint16Array.from(output.data, value => value * 257);
    // Native ImageMagick Q16-HDRI: line endpoint/interior and 72 responding pixels.
    expect([...samples.slice((5 * width + 2) * 4, (5 * width + 4) * 4)]).toEqual([224, 224, 224, 65535, 192, 192, 192, 65535]);
    expect(samples.filter((value, i) => i % 4 === 0 && value > 0)).toHaveLength(72);
    expect(samples.filter((_, i) => i % 4 === 3).every(value => value === 65535)).toBe(true);
});

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const highDepth of [false, true])
for (const virtualPixel of ["black", "white", "edge", "tile", "mirror", "background", "transparent"])
it(`${mode}: edge uses ${virtualPixel} virtual pixels (highDepth=${highDepth})`, async () => {
    const width = 32, height = 24, data = new Uint8Array(width * height * 4).fill(255);
    const input = encodeImage({ width, height, data, ...(highDepth ? { data16: new Uint16Array(data.length).fill(65535) } : {}),
        format: "png", density: 72, channels: 3, hasAlpha: false, space: "srgb", depth: highDepth ? "ushort" : "uchar" }, { format: "png" }).data;
    const files = new Map([["/input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const args = ["/input.png", "-background", "black", "-virtual-pixel", virtualPixel, "-edge", "1", "/out.png"];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = decodeImage(mode === "command" || mode === "retained" ? await fs.readFile("/out.png") : files.get("/out.png")!);
    const contrast = ["black", "background", "transparent"].includes(virtualPixel);
    expect(output.data).toEqual(Uint8Array.from(data, (_, i) => {
        const x = Math.floor(i / 4) % width, y = Math.floor(i / 4 / width);
        const boundary = x === 0 || x === width - 1 || y === 0 || y === height - 1;
        // Transparent virtual pixels activate alpha; native filters it too.
        if (i % 4 === 3) return virtualPixel === "transparent" && !boundary ? 0 : 255;
        return contrast && boundary ? 255 : 0;
    }));
});

// Native ImageMagick 7.1.2 Q16-HDRI, opaque 3x3 ramp, -edge 1.
for (const retained of [false, true])
it.each([
    ["tile", [0, 0, 0, 0, 0, 90, 180, 255, 255]],
    ["mirror", [0, 0, 0, 0, 0, 30, 60, 90, 120]],
    ["gray", [0, 0, 0, 0, 0, 0, 0, 0, 0]],
    ["background", [0, 0, 0, 0, 0, 114, 230, 234, 255]],
] as const)(`edge matches native %s boundaries (retained=${retained})`, async (method, expected) => {
    const data = Uint8Array.from({ length: 36 }, (_, i) => i % 4 === 3 ? 255 : (Math.floor(i / 4) + 1) * 10);
    const input = encodeImage({ width: 3, height: 3, data, format: "png", density: 72, channels: 3,
        hasAlpha: false, space: "srgb", depth: "uchar" }, { format: "png" }).data;
    const files = new Map([["/input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    const result = await runMagickCli(["/input.png", "-background", "#202020", "-virtual-pixel", method, "-edge", "1", "/out.png"], retained ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    const output = decodeImage(retained ? await fs.readFile("/out.png") : files.get("/out.png")!);
    expect([...output.data.filter((_, i) => i % 4 === 0)]).toEqual(expected);
});

for (const mode of ["command", "buffered", "retained", "sync"] as const)
for (const existing of [false, true])
it.each(["oops", "NaN", "Infinity", "", " "])(`${mode}: rejects invalid edge radius %j without changing output (existing=${existing})`, async radius => {
    const files = new Map([["/input.png", input]]), fs = new MemoryFileSystem();
    await fs.writeFile("/input.png", input);
    if (existing) {
        files.set("/out.png", input);
        await fs.writeFile("/out.png", input);
    }
    const args = ["/input.png", "-edge", radius, "/out.png"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async text => { stderr += new TextDecoder().decode(text); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(1);
    expect("stderr" in result ? result.stderr : stderr).toContain("invalid argument for option '-edge'");
    if (mode === "command" || mode === "retained") {
        if (existing) expect(new Uint8Array(await fs.readFile("/out.png"))).toEqual(new Uint8Array(input));
        else await expect(fs.readFile("/out.png")).rejects.toMatchObject({ code: "ENOENT" });
    } else expect(files.get("/out.png")).toEqual(existing ? input : undefined);
});

// Native ImageMagick Q16-HDRI: constant borders also populate black ink.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    ["white", "#505050", "0000000000000000"],
    ["gray", "#505050", "000000ff00000000"],
    ["gray", "#808080", "0000000d00000000"],
    ["edge", "#505050", "000000c000000000"],
] as const)(`${mode}: matches native CMYK edge with %s virtual pixels and %s`, async (method, color, expected) => {
    const files = new Map<string, Uint8Array>(), fs = new MemoryFileSystem();
    const args = [`xc:${color}`, "xc:#909090", "+append", "-colorspace", "CMYK", "-seed", "3",
        "-virtual-pixel", method, "-edge", "1", "-depth", "8", "cmyk:/out.raw"];
    let stderr = "";
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async text => { stderr += new TextDecoder().decode(text); } },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result.exitCode).toBe(0);
    expect("stderr" in result ? result.stderr : stderr).toBe("");
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});

// Native ImageMagick 7.1.2-35 Q16-HDRI: CMYK ink filtering and sRGB controls.
for (const mode of ["command", "buffered", "retained", "sync"] as const)
it.each([
    [["-colorspace", "CMYK", "-channel", "K", "-separate", "+channel"], "gray", "9f7fcf"],
    [["-colorspace", "CMYK", "-channel", "K", "-edge", "1", "-separate", "+channel"], "gray", "6000f0"],
    [["-colorspace", "CMYK", "+channel", "-colorspace", "sRGB"], "rgba", "405060ff506080ff203030ff"],
    [["-colorspace", "CMYK", "-edge", "1", "+channel", "-colorspace", "sRGB"], "rgba", "b3c79fffff00ffff111a0fff"],
    [["-colorspace", "sRGB", "-edge", "1", "+channel", "-colorspace", "sRGB"], "rgba", "000000ffc0c0ffff000000ff"],
] as const)(`${mode}: matches native CMYK edge pipeline %j`, async (operations, format, expected) => {
    const files = new Map([["/out.raw", Buffer.from("KEEP")]]), fs = new MemoryFileSystem();
    await fs.writeFile("/out.raw", Buffer.from("KEEP"));
    const args = ["xc:#405060", "xc:#506080", "xc:#203030", "+append", ...operations, "-depth", "8", `${format}:/out.raw`];
    const result = mode === "command" ? await createMagickCommand().execute({
        command: "magick", args: createCommandArguments(args).args, cwd: "/", env: {}, fs,
        stdin: (async function* () {})(), signal: new AbortController().signal,
        stdout: { write: async () => {} }, stderr: { write: async () => {} },
    }) : mode === "sync" ? runMagickCliSync(args, files)
        : await runMagickCli(args, mode === "retained" ? { filesystem: fs, cwd: "/" } : files);
    expect(result).toMatchObject({ exitCode: 0 });
    const output = mode === "command" || mode === "retained" ? await fs.readFile("/out.raw") : files.get("/out.raw")!;
    expect(Buffer.from(output).toString("hex")).toBe(expected);
});
