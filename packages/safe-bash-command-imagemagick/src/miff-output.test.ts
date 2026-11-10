import { spawnSync } from "node:child_process";
import { expect, it } from "vitest";
import { decodeImage, encodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCli, runMagickCliSync } from "./index.js";

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
  for (const output of ["mid.miff", "MIFF:mid.bin"]) for (const count of [1, 2]) {
    it.each(["-write", "+write", "final"])(`preserves the image list after %s MIFF in ${mode}, ${output}, frames=${count}`, async option => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const pixels = [255, 0, 0, 255, 0, 0, 255, 255];
        for (const [index, name] of ["r.png", "b.png"].entries()) {
            const { data } = encodeImage({ width: 1, height: 1, format: "png", space: "srgb", depth: "uchar", density: 72, channels: 4, hasAlpha: true, data: new Uint8Array(pixels.slice(index * 4, index * 4 + 4)) }, { format: "png" });
            files.set(name, data);
            await filesystem.writeFile(`/${name}`, data);
        }
        const inputs = ["r.png", "b.png"].slice(0, count);
        const path = output.startsWith("MIFF:") ? output.slice(5) : output;
        const args = option === "final" ? [...inputs, output] : [...inputs, option, output, "+append", "out.png"];
        const retained = mode === "retained" || mode === "command";
        let stdout = "", stderr = "";
        const result = mode === "command" ? { ...await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        }), stdout, stderr } : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, retained ? { filesystem, cwd: "/" } : files);
        expect(result).toMatchObject({ exitCode: 0, stdout: "", stderr: "" });
        const bytes = retained ? await filesystem.readFile(`/${path}`) : files.get(path)!;
        let offset = 0;
        for (const pixel of [pixels.slice(0, 4), pixels.slice(4)].slice(0, count)) {
            const end = bytes.indexOf(26, offset);
            expect(new TextDecoder().decode(bytes.subarray(offset, end))).toContain("id=ImageMagick");
            expect([...bytes.subarray(end + 1, end + 5)]).toEqual(pixel);
            offset = end + 5;
        }
        expect(offset).toBe(bytes.length);
        if (option === "final") return;
        const final = decodeImage(retained ? await filesystem.readFile("/out.png") : files.get("out.png")!);
        expect([final.width, final.height]).toEqual([count, 1]);
        expect([...final.data]).toEqual(pixels.slice(0, count * 4));
    });
}
}

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it(`preserves each MIFF frame's linear RGB colorspace in ${mode}`, async () => {
        const files = new Map<string, Uint8Array>();
        const filesystem = new MemoryFileSystem();
        const args = ["xc:#123456", "xc:#abcdef", "+append", "-colorspace", "RGB", "(", "xc:#abcdef", ")", "out.miff"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.miff") : files.get("out.miff")!;
        const firstEnd = bytes.indexOf(26);
        expect(new TextDecoder().decode(bytes.subarray(0, firstEnd))).toContain("colorspace=RGB\n");
        expect([...bytes.subarray(firstEnd + 1, firstEnd + 7)]).toEqual([2, 9, 24, 104, 156, 220]);
        const secondEnd = bytes.indexOf(26, firstEnd + 7);
        expect(new TextDecoder().decode(bytes.subarray(firstEnd + 7, secondEnd))).toContain("colorspace=sRGB\n");
        expect([...bytes.subarray(secondEnd + 1)]).toEqual([171, 205, 239]);
    });
}

for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    for (const depth of [undefined, 8, 16] as const) for (const highDepth of [false, true]) {
        it(`preserves MIFF samples in ${mode}, source16=${highDepth}, depth=${depth}`, async () => {
            const samples = new Uint16Array([0x1234, 0x5678, 0x9abc, 0x8001, 0xabcd, 0xef01, 0x3456, 0]);
            const pixels = Uint8Array.from(samples, value => value >>> 8);
            const { data } = encodeImage({ width: 2, height: 1, format: "png", space: "srgb", depth: highDepth ? "ushort" : "uchar", density: 72, channels: 4, hasAlpha: true, data: pixels, ...(highDepth ? { data16: samples } : {}) }, { format: "png", pngBitDepth: highDepth ? 16 : 8 });
            const files = new Map([["in.png", data]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.png", data);
            const args = ["in.png", ...(depth === undefined ? [] : ["-depth", String(depth)]), "-write", "mid.miff", "in.png", "out.miff"];
            const result = mode === "command" ? await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs: filesystem,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write() {} }
            }) : mode === "sync" ? runMagickCliSync(args, files)
                : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
            expect(result.exitCode).toBe(0);
            const outputDepth = depth ?? (highDepth ? 16 : 8);
            const expected = outputDepth === 8 ? pixels : Uint8Array.from([...samples].flatMap((value, index) => highDepth ? [value >>> 8, value & 255] : [pixels[index]!, pixels[index]!]));
            for (const [name, count] of [["mid.miff", 1], ["out.miff", 2]] as const) {
                const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile(`/${name}`) : files.get(name)!;
                let offset = 0;
                for (let frame = 0; frame < count; frame++) {
                    const end = bytes.indexOf(26, offset);
                    expect(new TextDecoder().decode(bytes.subarray(offset, end))).toContain(`depth=${outputDepth}\n`);
                    // -depth rounds existing Q16 samples; the later input has not run that operator.
                    const frameExpected = frame === 0 && highDepth && depth === 8 ? Uint8Array.from(samples, value => Math.round(value / 257)) : expected;
                    expect(bytes.subarray(end + 1, end + 1 + expected.length)).toEqual(frameExpected);
                    offset = end + 1 + expected.length;
                }
                expect(offset).toBe(bytes.length);
            }
        });
    }
}

const nativeMagick = spawnSync("magick", ["-version"]).status === 0;
for (const mode of ["buffered", "retained", "sync", "command"] as const) {
    it.each([
        { alpha: false, gray: false, channels: "srgb  3.0", colorspace: "sRGB", count: 3 },
        { alpha: true, gray: false, channels: "srgba 4.0", colorspace: "sRGB", count: 4 },
        { alpha: false, gray: true, channels: "gray  1.0", colorspace: "Gray", count: 1 },
        { alpha: true, gray: true, channels: "graya 2.0", colorspace: "Gray", count: 2 }
    ])(`writes source MIFF channels in ${mode}: alpha=$alpha gray=$gray`, async ({ alpha, gray, channels, colorspace, count }) => {
        const { data } = encodeImage({ width: 2, height: 1, format: "png", space: "srgb", depth: "uchar", density: 72, channels: alpha ? 4 : 3, hasAlpha: alpha,
            data: new Uint8Array([18, 52, 86, alpha ? 128 : 255, 171, 205, 239, alpha ? 0 : 255]) }, { format: "png" });
        const files = new Map([["input.png", data]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/input.png", data);
        const args = ["input.png", ...(gray ? ["-colorspace", "Gray"] : []), "out.miff"];
        const result = mode === "command" ? await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs: filesystem,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write() {} }, stderr: { async write() {} }
        }) : mode === "sync" ? runMagickCliSync(args, files)
            : await runMagickCli(args, mode === "retained" ? { filesystem, cwd: "/" } : files);
        expect(result.exitCode).toBe(0);
        const bytes = mode === "retained" || mode === "command" ? await filesystem.readFile("/out.miff") : files.get("out.miff")!;
        const end = bytes.indexOf(26);
        const header = new TextDecoder().decode(bytes.subarray(0, end));
        expect(header).toContain(`matte=${alpha ? "True" : "False"}`);
        expect(header).toContain(`colorspace=${colorspace}\n`);
        expect(bytes.length - end - 1).toBe(2 * count);
        if (nativeMagick) {
            const identified = spawnSync("magick", ["identify", "-format", "%[colorspace]|%[channels]", "miff:-"], { input: bytes });
            expect(identified.status).toBe(0);
            expect(identified.stdout.toString()).toBe(`${colorspace}|${channels}`);
            if (!gray) {
                const decoded = spawnSync("magick", ["miff:-", "-depth", "8", "rgba:-"], { input: bytes });
                expect(decoded.status).toBe(0);
                expect([...decoded.stdout]).toEqual([18, 52, 86, alpha ? 128 : 255, 171, 205, 239, alpha ? 0 : 255]);
            }
        }
    });
}
