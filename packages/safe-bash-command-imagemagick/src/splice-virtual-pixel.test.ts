import { expect, it } from "vitest";
import sharp, { decodeImage } from "@poe-code/image-ast";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createCommandArguments } from "safe-bash-contracts/command";
import { createMagickCommand, runMagickCli } from "./index.js";

// Native ImageMagick RGBA16 input; low bits differ from the 8-bit samples.
const input16 = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAQAAAADEAYAAADkZHKFAAAAJklEQVQI12Pk4hYRlZMPCBQS4uVlZ+fmRqdZPDxMTGRkdHTIVgAAk6YHqN3DPjUAAAAASUVORK5CYII=", "base64");

for (const depth of [8, 16]) for (const mode of ["buffered", "retained", "command"]) {
    for (const offset of [6, 4, -2]) {
        it.each(["tile", "transparent", "mirror", "edge", "background", "black", "white", "gray"])(`${mode}, depth ${depth}: splice offset ${offset} uses %s virtual pixels`, async method => {
            const pixels = Uint8Array.from(Array.from({ length: 12 }, (_, i) => [10 + i * 18, 20 + i * 13, 30 + i * 7, 80 + i * 11]).flat());
            const bytes = depth === 16 ? input16 : await sharp(pixels, { raw: { width: 4, height: 3, channels: 4 } }).png().toBuffer();
            const files = new Map([["input.png", bytes]]), filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/input.png", bytes);
            const args = ["input.png", "-background", "#ff00ff", "-virtual-pixel", method, "-splice", `2x0${offset >= 0 ? "+" : ""}${offset}+0`, `PNG${depth === 16 ? 64 : 32}:out.png`];
            if (mode === "command") {
                const command = createMagickCommand(), argumentValues = createCommandArguments(args);
                const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                    cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                    stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
                expect(result.exitCode).toBe(0);
            } else {
                expect((await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).exitCode).toBe(0);
            }
            const output = decodeImage(mode === "buffered" ? files.get("out.png")! : await filesystem.readFile("/out.png"));
            expect([output.width, output.height]).toEqual([6, 3]);
            const expected: number[] = [];
            const source = depth === 16 ? Array.from(pixels, value => value * 257 + 1) : Array.from(pixels);
            const scale = depth === 16 ? 257 : 1;
            for (let y = 0; y < 3; y++) for (let x = 0; x < 6; x++) {
                if (x < 4) expected.push(...source.slice((y * 4 + x) * 4, (y * 4 + x + 1) * 4));
                else if (offset === 4 || method === "background") expected.push(255 * scale, 0, 255 * scale, 255 * scale);
                else if (method === "transparent") expected.push(0, 0, 0, 0);
                else if (["black", "white", "gray"].includes(method)) {
                    const value = method === "white" ? 255 * scale : method === "gray" ? depth === 16 ? 0x8000 : 128 : 0;
                    expected.push(value, value, value, 255 * scale);
                } else {
                    const sourceX = method === "tile" ? x - 4 : method === "mirror" ? 7 - x : 3;
                    expected.push(...source.slice((y * 4 + sourceX) * 4, (y * 4 + sourceX + 1) * 4));
                }
            }
            expect(Array.from(depth === 16 ? output.data16! : output.data)).toEqual(expected);
        });
    }
}

for (const mode of ["buffered", "retained", "command"]) {
    it.each([
        { colorspace: "sRGB", virtualPixel: "gray", output: ["-channel", "R", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:out"], hex: "4545454545458000" },
        { colorspace: "Lab", virtualPixel: "gray", output: ["-channel", "R", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:out"], hex: "8d2c8d2c8d2c8000" },
        { colorspace: "HSL", virtualPixel: "gray", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:out"], hex: "458abcff458abcff458abcff40bfbfff" },
        { colorspace: "sRGB", virtualPixel: "white", output: ["-channel", "R", "-separate", "+channel", "-depth", "16", "-endian", "MSB", "gray:out"], hex: "454545454545ffff" },
        { colorspace: "HSL", virtualPixel: "edge", output: ["-colorspace", "sRGB", "-depth", "8", "rgba:out"], hex: "458abcff458abcff458abcff458abcff" }
    ])(`${mode}: splice exposes $virtualPixel samples in $colorspace`, async ({ colorspace, virtualPixel, output, hex }) => {
        const files = new Map([["out", Buffer.from("KEEP")]]), filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/out", Buffer.from("KEEP"));
        const args = ["-size", "3x1", "xc:#458abc", "-colorspace", colorspace, "-background", "#2468ac", "-virtual-pixel", virtualPixel, "-splice", "1x0+4+0", ...output];
        if (mode === "command") {
            const command = createMagickCommand(), argumentValues = createCommandArguments(args);
            const result = await command.execute({ command: command.name, args: argumentValues.args, argumentValues,
                cwd: "/", env: {}, fs: filesystem, signal: new AbortController().signal,
                stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} } });
            expect(result.exitCode).toBe(0);
        } else {
            expect((await runMagickCli(args, mode === "buffered" ? files : { filesystem, cwd: "/" })).exitCode).toBe(0);
        }
        const bytes = mode === "buffered" ? files.get("out")! : await filesystem.readFile("/out");
        expect(Buffer.from(bytes).toString("hex")).toBe(hex);
    });
}
