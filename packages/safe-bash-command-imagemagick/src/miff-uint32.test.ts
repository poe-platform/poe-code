import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: 4x2 RGBA16 input, -depth 32 -compress None miff:-.
// Native PNG64 and -depth 16 -endian MSB rgba:- outputs retain these exact samples.
const original = "010104018001ffff".repeat(3) + "0000fffe02bc7530" + "11121edd535ed903".repeat(4);
const flopped = "0000fffe02bc7530" + "010104018001ffff".repeat(3) + "11121edd535ed903".repeat(4);

for (const depth of [16, 32]) for (const mode of ["command", "sync"]) {
    it.each([
        [[], "PNG64", original],
        [["-flop"], "PNG64", flopped],
        [["-depth", "16", "-endian", "MSB"], "rgba", original]
    ] as [string[], string, string][])(`reads unsigned ${depth}-bit MIFF through ${mode}: %j %s`, async (options, coder, expected) => {
        const samples = Buffer.from(original, "hex"), raster = Buffer.alloc(samples.length * depth / 16);
        for (let i = 0; i < samples.length / 2; i++) {
            if (depth === 32) raster.writeUInt32BE(samples.readUInt16BE(i * 2) * 65537, i * 4);
            else raster.writeUInt16BE(samples.readUInt16BE(i * 2), i * 2);
        }
        const input = Buffer.concat([Buffer.from(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 alpha-trait=Blend\ncolumns=4 rows=2 depth=${depth}\ncolorspace=sRGB compression=None\n\f\n:\x1a`), raster]);
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
