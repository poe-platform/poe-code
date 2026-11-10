import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";
import fixtures from "./miff-working-fixtures.json" with { type: "json" };

// ImageMagick 7.1.2-35 Q16-HDRI oracle, starting with RGBA8
// 1234abcdff0080ff1234abcd55660080 repeated twice:
// magick -size 4x2 -depth 8 rgba:- [-alpha off] -colorspace <space>
//   -depth <depth> -compress None miff:-
// Capture its raster and info:, then convert to sRGB for RGBA8 and PNG64.
// rgba16 contains the decoded PNG64 big-endian samples.
for (const fixture of fixtures) for (const mode of ["command", "sync"] as const) {
    it.each(["info", "rgba", "PNG64"])(`reads ${fixture.space} MIFF (${fixture.depth}-bit, alpha=${fixture.alpha}) through ${mode}: %s`, async coder => {
        const input = Buffer.concat([
            Buffer.from(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=${fixture.alpha}\ncolumns=4 rows=2 depth=${fixture.depth}\ncolorspace=${fixture.space} compression=None\n\f\n:\x1a`),
            Buffer.from(fixture.raster, "hex")
        ]);
        const files = new Map<string, Uint8Array>([["/in.miff", input], ["/out", Buffer.from("KEEP")]]);
        const fs = new MemoryFileSystem();
        for (const [path, bytes] of files) await fs.writeFile(path, bytes);
        const args = ["/in.miff", ...(coder === "info" ? ["-format", "%[colorspace]|%[channels]", "info:"]
            : ["-colorspace", "sRGB", ...(coder === "rgba" ? ["-depth", "8"] : []), `${coder}:/out`])];
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs, signal: new AbortController().signal,
            stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ ...result, stderr: "stderr" in result ? result.stderr : stderr }).toMatchObject({ exitCode: 0, stderr: "" });
        const output = mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
        if (coder === "info") {
            expect("stdout" in result ? result.stdout : stdout).toBe(fixture.info);
            expect(Buffer.from(output).toString()).toBe("KEEP");
        } else if (coder === "rgba") expect(Buffer.from(output).toString("hex")).toBe(fixture.rgba8);
        else {
            const image = decodeImage(output), expected = Buffer.from(fixture.rgba16, "hex");
            expect([image.width, image.height]).toEqual([4, 2]);
            expect([...image.data16!]).toEqual(Array.from({ length: expected.length / 2 }, (_, i) => expected.readUInt16BE(i * 2)));
        }
    });
}
