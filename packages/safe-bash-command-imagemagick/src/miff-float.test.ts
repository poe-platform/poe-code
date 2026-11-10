import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Normalized IEEE samples from RGBA16 input. Expected PNG64/raw samples are
// the ImageMagick 7.1.2-35 Q16-HDRI oracle, including binary16 rounding.
const fixtures = [
    { depth: 16, format: "floating-point", raster: "1c04240138003c00".repeat(3) + "00003c0021783753" + "2c452fb735363ac8".repeat(4), first: "010104018000ffff", second: "0000ffff02bc7530", last: "11141edc5360d8ff" },
    { depth: 32, format: "floating-point", raster: "3b8080813c8020803f0001803f800000".repeat(3) + "000000003f7fff003c2f00af3eea60ea" + "3d8890893df6e8f73ea6bca73f5903d9".repeat(4), first: "010104018001ffff", second: "0000fffe02bc7530", last: "11121edd535ed903" },
    { depth: 16, format: "unsigned", raster: "010104018001ffff".repeat(3) + "0000fffe02bc7530" + "11121edd535ed903".repeat(4), first: "010104018001ffff", second: "0000fffe02bc7530", last: "11121edd535ed903" }
];

for (const { depth, format, raster, first, second, last } of fixtures) for (const mode of ["command", "sync"]) {
    it.each([
        [[], "PNG64", first.repeat(3) + second + last.repeat(4)],
        [["-flop"], "PNG64", second + first.repeat(3) + last.repeat(4)],
        [["-depth", "16", "-endian", "MSB"], "rgba", first.repeat(3) + second + last.repeat(4)]
    ] as [string[], string, string][])(`reads ${format} ${depth}-bit MIFF through ${mode}: %j %s`, async (options, coder, expected) => {
        const input = Buffer.concat([Buffer.from(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 alpha-trait=Blend\ncolumns=4 rows=2 depth=${depth}\ncolorspace=sRGB compression=None quantum:format=${format}\n\f\n:\x1a`), Buffer.from(raster, "hex")]);
        const files = new Map<string, Uint8Array>([["/in.miff", input], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/in.miff", ...options, `${coder}:/out`];
        let stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(), stdout: { async write() {} },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        if (coder === "PNG64") {
            const image = decodeImage(output), bytes = Buffer.from(expected, "hex");
            expect([image.width, image.height]).toEqual([4, 2]);
            expect([...image.data16!]).toEqual(Array.from({ length: bytes.length / 2 }, (_, i) => bytes.readUInt16BE(i * 2)));
        } else expect(Buffer.from(output).toString("hex")).toBe(expected);
    });
}

for (const mode of ["command", "sync"]) it.each([8, 32])(`rejects invalid float depth/raster %s without replacing output through ${mode}`, async depth => {
    const input = Buffer.from(`id=ImageMagick version=1.0\nclass=DirectClass columns=1 rows=1 depth=${depth}\ncolorspace=sRGB quantum:format=floating-point\n\f\n:\x1a\x00\x00\x00`);
    const files = new Map<string, Uint8Array>([["/in.miff", input], ["/out", Buffer.from("KEEP")]]);
    const fs = new MemoryFileSystem();
    for (const [path, bytes] of files) await fs.writeFile(path, bytes);
    const args = ["/in.miff", "PNG64:/out"];
    const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
        command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
        stdin: (async function* () {})(), stdout: { async write() {} }, stderr: { async write() {} }
    });
    expect(result.exitCode).toBe(1);
    expect(Buffer.from(mode === "sync" ? files.get("/out")! : await fs.readFile("/out")).toString()).toBe("KEEP");
});
