import { expect, it } from "vitest";
import { decodeImage } from "@poe-code/image-ast/portable";
import { MemoryFileSystem } from "@poe-code/safe-fs/core";
import { createMagickCommand, runMagickCliSync } from "./index.js";

// Uncompressed DirectClass MIFF headers; native ImageMagick reports the tick
// counts (1 and 7), even though the durations are 1000/24 and 7 milliseconds.
function frame(fields: string, pixel: number[]) {
    return new Uint8Array([...new TextEncoder().encode(`id=ImageMagick version=1.0\nclass=DirectClass colors=0 matte=False\ncolumns=2 rows=1 depth=8\ncolorspace=sRGB compression=None\n${fields}\n\f\n:\x1a`), ...pixel, ...pixel]);
}
const red = frame("delay=1 ticks-per-second=24", [255, 0, 0]);
const blue = frame("delay=7 ticks-per-second=1000", [0, 0, 255]);

for (const mode of ["command", "sync"] as const) {
    it.each([
        { inputs: ["control.miff[0]"], expected: "1|srgb(255,0,0)|" },
        { inputs: ["blue.miff[0]", "control.miff[0]"], expected: "7|srgb(0,0,255)|1|srgb(255,0,0)|" },
        { inputs: ["control.miff[0]", "blue.miff[0]"], expected: "1|srgb(255,0,0)|7|srgb(0,0,255)|" },
        { inputs: ["plain.miff"], expected: "0|srgb(255,0,0)|" },
        { inputs: ["default.miff"], expected: "16|srgb(255,0,0)|" },
        { inputs: ["-delay", "5", "control.miff[0]"], expected: "5|srgb(255,0,0)|" },
        { inputs: ["control.miff[0]", "-set", "delay", "5"], expected: "5|srgb(255,0,0)|" }
    ])(`reads MIFF timing and pixels in order (${mode}): $inputs`, async ({ inputs, expected }) => {
        const files = new Map([
            ["control.miff", new Uint8Array([...red, ...blue])], ["blue.miff", blue],
            ["plain.miff", frame("", [255, 0, 0])], ["default.miff", frame("delay=16", [255, 0, 0])]
        ]);
        const fs = new MemoryFileSystem();
        for (const [name, bytes] of files) await fs.writeFile(`/${name}`, bytes);
        const args = [...inputs, "-format", "%T|%[pixel:p{0,0}]|", "info:"];
        let stdout = "", stderr = "";
        const result = mode === "sync" ? runMagickCliSync(args, files) : await createMagickCommand().execute({
            command: "magick", args, cwd: "/", env: {}, fs,
            signal: new AbortController().signal, stdin: (async function* () {})(),
            stdout: { async write(bytes) { stdout += new TextDecoder().decode(bytes); } },
            stderr: { async write(bytes) { stderr += new TextDecoder().decode(bytes); } }
        });
        expect({ stdout, stderr, ...result }).toMatchObject({ exitCode: 0, stdout: expected, stderr: "" });
    });
}

it("decodes MIFF durations in milliseconds without losing the tick rate", () => {
    expect(decodeImage(red)).toMatchObject({ delay: [1000 / 24], ticksPerSecond: 24 });
    expect(decodeImage(blue)).toMatchObject({ delay: [7], ticksPerSecond: 1000 });
});
