import { expect, it } from "vitest";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { encodeImage, decodeImage } from "@poe-code/image-ast";
import { runMagickCli, runMagickCliSync } from "./index.js";

// Native ImageMagick output, checked with od; independent of the PAM codec.
const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000010806000000f4227f8a000000114944415408d7631032096b587df6bd03000dba03c49aeb799b0000000049454e44ae426082", "hex");
const samples = Buffer.from("12345680abcdef40", "hex");
const pam = Buffer.concat([Buffer.from("P7\nWIDTH 2\nHEIGHT 1\nDEPTH 4\nMAXVAL 255\nTUPLTYPE RGB_ALPHA\nENDHDR\n"), samples]);

for (const sync of [false, true]) {
    for (const destination of ["out.pam", "pam:out.bin"]) it(`writes PAM bytes and alpha to ${destination}, sync=${sync}`, async () => {
        const files = new Map<string, Uint8Array>([["in.png", png]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", png);
        const args = ["in.png", destination];
        const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const path = destination === "out.pam" ? "out.pam" : "out.bin";
        const output = sync ? files.get(path)! : await filesystem.readFile("/" + path);
        expect(Buffer.from(output)).toEqual(pam);
        expect(Buffer.from(decodeImage(output).data)).toEqual(samples);
    });

    it(`reads native P7 with alpha into PNG, sync=${sync}`, async () => {
        const files = new Map<string, Uint8Array>([["in.pam", pam]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.pam", pam);
        const args = ["in.pam", "out.png"];
        const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = sync ? files.get("out.png")! : await filesystem.readFile("/out.png");
        expect(Buffer.from(decodeImage(output).data)).toEqual(samples);
    });
}

for (const sync of [false, true]) for (const hasAlpha of [false, true]) {
    it(`writes Gray PAM with hidden samples, sync=${sync}, alpha=${hasAlpha}`, async () => {
        const input = encodeImage({ width: 2, height: 1, data: new Uint8Array([18, 52, 86, 128, 171, 205, 239, 0]), hasAlpha, space: "srgb", format: "png", channels: hasAlpha ? 4 : 3, depth: "uchar", density: 72 }, { format: "png", pngColorType: hasAlpha ? 6 : 2 }).data;
        const files = new Map([["in.png", input]]);
        const filesystem = new MemoryFileSystem();
        await filesystem.writeFile("/in.png", input);
        const args = ["in.png", "-colorspace", "Gray", "out.pam"];
        const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
        expect(result.stderr).toBe("");
        expect(result.exitCode).toBe(0);
        const output = sync ? files.get("out.pam")! : await filesystem.readFile("/out.pam");
        expect(Buffer.from(output)).toEqual(Buffer.concat([
            Buffer.from(`P7\nWIDTH 2\nHEIGHT 1\nDEPTH ${hasAlpha ? 2 : 1}\nMAXVAL 255\nTUPLTYPE ${hasAlpha ? "GRAYSCALE_ALPHA" : "GRAYSCALE"}\nENDHDR\n`),
            Buffer.from(hasAlpha ? "2f80c800" : "2fc8", "hex")
        ]));
    });
}

for (const sync of [false, true]) for (const alpha of [false, true]) for (const depth of [8, 16]) {
    it(`preserves CMYK inks and separate alpha, sync=${sync}, alpha=${alpha}, depth=${depth}`, async () => {
        const inks = Buffer.from(alpha ? "00ffff0080ff000080ff" : "00ffff00ff000080", "hex");
        const samples = depth === 8 ? inks : Buffer.from(Array.from(inks).flatMap(value => [value, value]));
        const input = Buffer.concat([Buffer.from(`P7\nWIDTH 2\nHEIGHT 1\nDEPTH ${alpha ? 5 : 4}\nMAXVAL ${depth === 8 ? 255 : 65535}\nTUPLTYPE CMYK${alpha ? "_ALPHA" : ""}\nENDHDR\n`), samples]);
        for (const convert of [false, true]) {
            const files = new Map([["in.pam", input as Uint8Array]]);
            const filesystem = new MemoryFileSystem();
            await filesystem.writeFile("/in.pam", input);
            const args = convert ? ["in.pam", "-colorspace", "sRGB", "-depth", "8", "out.rgba"] : ["in.pam", "out.pam"];
            const result = sync ? runMagickCliSync(args, files) : await runMagickCli(args, { filesystem, cwd: "/" });
            expect(result.stderr).toBe("");
            expect(result.exitCode).toBe(0);
            const path = convert ? "out.rgba" : "out.pam";
            const output = sync ? files.get(path)! : await filesystem.readFile("/" + path);
            expect(Buffer.from(output)).toEqual(convert ? Buffer.from(alpha ? "ff000080007f7fff" : "ff0000ff007f7fff", "hex") : input);
        }
    });
}
