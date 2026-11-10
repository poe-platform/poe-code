import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Uncompressed MIFF equivalent of ImageMagick 7.1.2-35 Q16-HDRI:
// magick -size 4x2 -depth 8 rgba:i.rgba -orient RightTop -compress None orient.miff
const pixels = "1234abcdff0080ff1234abcd55660080".repeat(2);
const rotated = "1234abcd1234abcdff0080ffff0080ff1234abcd1234abcd5566008055660080";
function fixture(orientation: string) {
    return new Uint8Array([
        ...new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=True\ncolumns=4 rows=2 depth=8\ncolorspace=sRGB compression=None\n${orientation ? `orientation=${orientation}` : ""}\n\f\n:\x1a`),
        ...Buffer.from(pixels, "hex")
    ]);
}

for (const mode of ["command", "sync"] as const) {
    it.each(["", "Undefined", "TopLeft", "TopRight", "BottomRight", "BottomLeft", "LeftTop", "RightTop", "RightBottom", "LeftBottom"])(
        `reports MIFF orientation %s (${mode})`, async orientation => {
            const input = fixture(orientation), files = new Map([["/in.miff", input]]), fs = new MemoryFileSystem();
            await fs.writeFile("/in.miff", input);
            const args = ["/in.miff", "-format", "%[orientation]", "info:"];
            let stdout = "", stderr = "";
            const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect({ stdout, stderr, ...result }).toMatchObject({ exitCode: 0, stdout: orientation || "Undefined", stderr: "" });
        }
    );

    for (const format of ["rgba", "PNG64"]) for (const autoOrient of [false, true]) {
        it.each(["", "Undefined", "RightTop"])(`preserves MIFF samples for orientation %s, auto-orient=${autoOrient}, ${format} (${mode})`, async orientation => {
            const input = fixture(orientation), keep = new TextEncoder().encode("KEEP");
            const files = new Map([["/in.miff", input], ["/out", keep]]), fs = new MemoryFileSystem();
            for (const [name, bytes] of files) await fs.writeFile(name, bytes);
            const args = ["/in.miff", ...(autoOrient ? ["-auto-orient"] : []), "-depth", "8", `${format}:/out`];
            let stderr = "";
            const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect({ stderr, ...result }).toMatchObject({ exitCode: 0, stderr: "" });
            const output = mode === "sync" ? files.get("/out")! : await fs.readFile("/out");
            const rotate = autoOrient && orientation === "RightTop", expected = Buffer.from(rotate ? rotated : pixels, "hex");
            if (format === "rgba") expect([...output]).toEqual([...expected]);
            else {
                const image = decodeImage(output);
                expect(image).toMatchObject({ width: rotate ? 2 : 4, height: rotate ? 4 : 2 });
                expect([...image.data16!]).toEqual([...expected].map(value => value * 257));
            }
        });
    }
}
