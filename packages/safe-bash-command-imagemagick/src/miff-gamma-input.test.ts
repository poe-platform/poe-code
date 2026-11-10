import { expect, it } from "vitest";
import { decodeImage, readImageMetadata } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// ImageMagick 7.1.2-35 Q16-HDRI: -size 4x2 -depth 8 rgba:-
// [-set gamma 0.8] -compress None miff:-; omit volatile date properties.
const pixels = new Uint8Array(Buffer.from("1234abcdff0080ff1234abcd55660080".repeat(2), "hex"));
function fixture(gamma?: number) {
    const header = `id=ImageMagick version=1.0
class=DirectClass colors=0 alpha-trait=Blend
number-channels=4 number-meta-channels=0 channel-mask=0x0000000007ffffff
matte=True
columns=4 rows=2 depth=8
type=TrueColor
colorspace=sRGB
compression=None quality=0
page=4x2+0+0
rendering-intent=Perceptual
${gamma === undefined ? "" : `gamma=${gamma}`}
red-primary=0.64,0.33 green-primary=0.3,0.6 blue-primary=0.15,0.06
white-point=0.3127,0.329
\f
:\x1a`;
    return new Uint8Array([...new TextEncoder().encode(header), ...pixels]);
}

for (const gamma of [0.8, 0.454545, undefined]) {
    const input = fixture(gamma), expected = String(gamma ?? 0.454545);
    for (const mode of ["sync", "command"] as const) {
        it(`reports MIFF gamma ${gamma} through ${mode}`, async () => {
            const fs = new MemoryFileSystem();
            await fs.writeFile("/in.miff", input);
            let stdout = "", stderr = "";
            const args = ["in.miff", "-format", "%[gamma]", "info:"];
            const result = mode === "sync" ? runMagickCliSync(args, new Map([["in.miff", input]])) : await createMagickCommand().execute({
                command: "magick", args, cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
                stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect({ ...result, ...("stdout" in result ? {} : { stdout, stderr }) }).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
            expect(readImageMetadata(input).gamma).toBe(gamma);
        });
    }
    for (const output of ["PNG64:out.png", "rgba:out.rgba"]) {
        it(`preserves samples for MIFF gamma ${gamma} written to ${output}`, async () => {
            const fs = new MemoryFileSystem(), path = `/${output.split(":")[1]}`;
            await fs.writeFile("/in.miff", input);
            await fs.writeFile(path, new TextEncoder().encode("KEEP"));
            let stderr = "";
            const result = await createMagickCommand().execute({
                command: "magick", args: ["in.miff", "-depth", "8", output], cwd: "/", env: {}, fs,
                signal: new AbortController().signal, stdin: (async function* () {})(),
                stdout: { async write() {} }, stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
            });
            expect({ ...result, stderr }).toMatchObject({ exitCode: 0, stderr: "" });
            const bytes = await fs.readFile(path);
            if (output.startsWith("PNG64:")) {
                const image = decodeImage(bytes);
                expect([...image.data16!]).toEqual([...pixels].map(value => value * 257));
                if (gamma !== undefined) expect(image.gamma).toBe(gamma === 0.8 ? 0.8 : 0.45455);
            } else expect(bytes).toEqual(pixels);
        });
    }
}

it("reads each selected MIFF frame's gamma independently", async () => {
    const input = new Uint8Array([...fixture(0.8), ...fixture(1)]);
    for (const page of [0, 1]) {
        const fs = new MemoryFileSystem();
        await fs.writeFile("/in.miff", input);
        let stdout = "";
        const result = await createMagickCommand().execute({
            command: "magick", args: [`in.miff[${page}]`, "-format", "%[gamma]", "info:"], cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } }, stderr: { async write() {} }
        });
        expect(result.exitCode).toBe(0);
        expect(stdout).toBe(page === 0 ? "0.8" : "1");
    }
});
